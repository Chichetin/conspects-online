#!/usr/bin/env python3
"""Хранилище синхронизации прогресса чтения: один JSON-файл на код синхронизации.

Код — случайная строка, которую знают только устройства одного читателя; она же и пароль.
Сливает данные клиент (app.js), сервер лишь хранит последнюю версию и не даёт затереть
чужую запись: каждая запись несёт номер версии, на которой она основана.

  GET  /sync?code=<код>                  → 200 {"v": N, "data": {...}}   (новый код: v = 0, data = {})
  POST /sync?code=<код>  {"v": N, "data"} → 200 {"v": N + 1}             если N — текущая версия,
                                          → 409 {"v": M, "data": {...}}  если кто-то успел раньше
  GET  /health                            → 200 ok

POST принимает и text/plain, чтобы браузер не делал лишний preflight-запрос.
Только стандартная библиотека Python ≥ 3.9. Настройки — переменные окружения ниже.
"""
import json
import os
import re
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

DATA_DIR = Path(os.environ.get("SYNC_DIR", "./sync-data"))
HOST = os.environ.get("SYNC_HOST", "127.0.0.1")
PORT = int(os.environ.get("SYNC_PORT", "8787"))
ORIGINS = set(os.environ.get("SYNC_ORIGINS", "https://chichetin.github.io").split())
MAX_BODY = 512 * 1024
MAX_CODES = 1000  # сколько разных кодов можно завести — чтобы чужие не забили диск

CODE_RE = re.compile(r"[A-Za-z0-9_-]{22,64}")
lock = threading.Lock()


def load(path):
    try:
        return json.loads(path.read_text("utf-8"))
    except FileNotFoundError:
        return {"v": 0, "data": {}}


def save(path, record):
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


class Handler(BaseHTTPRequestHandler):
    server_version = "conspects-sync"
    sys_version = ""

    def cors(self):
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Vary", "Origin")

    def reply(self, status, body=None):
        raw = b"" if body is None else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Cache-Control", "no-store")
        if body is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def target(self):
        url = urlsplit(self.path)
        if url.path != "/sync":
            return None
        code = parse_qs(url.query).get("code", [""])[0]
        return DATA_DIR / f"{code}.json" if CODE_RE.fullmatch(code) else None

    def do_OPTIONS(self):
        self.reply(HTTPStatus.NO_CONTENT)

    def do_GET(self):
        if urlsplit(self.path).path == "/health":
            return self.reply(HTTPStatus.OK, "ok")
        path = self.target()
        if not path:
            return self.reply(HTTPStatus.BAD_REQUEST, {"error": "bad code"})
        with lock:
            self.reply(HTTPStatus.OK, load(path))

    def do_POST(self):
        path = self.target()
        if not path:
            return self.reply(HTTPStatus.BAD_REQUEST, {"error": "bad code"})
        size = int(self.headers.get("Content-Length") or 0)
        if size > MAX_BODY:
            return self.reply(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "too large"})
        try:
            body = json.loads(self.rfile.read(size))
            base, data = body["v"], body["data"]
            if not isinstance(base, int) or not isinstance(data, dict):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.reply(HTTPStatus.BAD_REQUEST, {"error": "bad body"})
        with lock:
            current = load(path)
            if current["v"] != base:
                return self.reply(HTTPStatus.CONFLICT, current)
            if base == 0 and sum(1 for _ in DATA_DIR.glob("*.json")) >= MAX_CODES:
                return self.reply(HTTPStatus.INSUFFICIENT_STORAGE, {"error": "too many codes"})
            save(path, {"v": base + 1, "data": data})
        self.reply(HTTPStatus.OK, {"v": base + 1})

    def log_request(self, code="-", size="-"):
        # без кода синхронизации в журнале: он и есть пароль
        print(f"{self.command} {urlsplit(self.path).path} {int(code)}", flush=True)


if __name__ == "__main__":
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"sync: {HOST}:{PORT}, данные в {DATA_DIR.resolve()}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
