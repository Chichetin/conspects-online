#!/usr/bin/env python3
"""Собирает сайт из content/ в _site/: страницы лекций (pandoc), страницы курсов и главную.

    python build.py
    python -m http.server -d _site   # предпросмотр
"""
import hashlib
import html
import json
import re
import shutil
import subprocess
import tomllib
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
SITE = ROOT / "site"
OUT = ROOT / "_site"
FONTS = ("https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700"
         "&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap")


def head(root: str) -> str:
    """Общая часть <head>. Инлайн-скрипт применяет настройки чтения до отрисовки, чтобы не было вспышки."""
    return f"""<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2f6db5">
<script>try{{var d=document.documentElement,s=localStorage;["theme","fs","review"].forEach(function(k){{var v=s.getItem(k);if(v)d.dataset[k]=v}})}}catch(e){{}}</script>
<link rel="manifest" href="{root}manifest.webmanifest">
<link rel="icon" href="{root}assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{root}assets/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="{root}assets/style.css">
<script defer src="{root}assets/app.js"></script>"""


def read_lecture(d: Path) -> dict:
    text = (d / "summary.md").read_text()
    head = text.split("\n---", 1)[0]

    def field(key: str) -> str:
        m = re.search(rf'^{key}:\s*"?(.*?)"?\s*$', head, re.M)
        return m[1] if m else ""

    duration = re.search(r"Запись\s+([\d:]+)", field("meta-line"))
    minutes = max(1, round(len(re.findall(r"\w+", text)) / 180))
    return {
        "num": int(d.name), "dir": d, "title": field("title"),
        "duration": duration[1] if duration else "",
        "minutes": minutes, "reading": f"{minutes} мин чтения",
    }


def page(title: str, root: str, body: str, color: str = "") -> str:
    style = f' style="--course: {color}"' if color else ""
    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>{html.escape(title)}</title>
{head(root)}
</head>
<body class="list-page"{style}>
<header class="site-bar"><a class="brand" href="{root}">Конспекты</a></header>
<main>
{body}
</main>
</body>
</html>
"""


def meta(l: dict) -> str:
    parts = [f"Лекция {l['num']}"] + ([f"запись {l['duration']}"] if l["duration"] else []) + [l["reading"]]
    return " · ".join(parts)


def lecture_list(lectures: list[dict], prefix: str) -> str:
    items = "\n".join(
        f'<li><a href="{prefix}{l["num"]}/">'
        f'<span class="num">{meta(l)}</span>'
        f'<span class="t">{html.escape(l["title"])}</span>'
        "</a></li>"
        for l in lectures
    )
    return f'<ol class="lectures">\n{items}\n</ol>'


def build_lecture(course: dict, lec: dict, prev: dict | None, nxt: dict | None) -> None:
    src, dst = lec["dir"], OUT / course["slug"] / str(lec["num"])
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("summary.md"))
    args = [
        "pandoc", str(src / "summary.md"), "-f", "markdown", "-t", "html5",
        "--standalone", "--template", str(SITE / "lecture.html"),
        "--lua-filter", str(SITE / "conspect.lua"),
        "--katex", "--section-divs", "--number-sections",
        "--toc", "--toc-depth=2",
        "-V", "root=../../", "-V", f"course-slug={course['slug']}",
        "-V", f"course-title={course['title']}", "-V", f"course-color={course.get('color', '')}",
        "-V", f"reading={lec['reading']}", "-V", f"minutes={lec['minutes']}",
        "-V", f"head={head('../../')}",
        "-o", str(dst / "index.html"),
    ]
    if (src / "conspect.pdf").exists():
        args += ["-V", "pdf=1"]
    for name, other in (("prev", prev), ("next", nxt)):
        if other:
            args += ["-V", f"{name}-href=../{other['num']}/", "-V", f"{name}-title={other['title']}"]
    subprocess.run(args, check=True)


TEX_SYMBOLS = {"alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "varepsilon": "ε", "epsilon": "ε",
               "theta": "θ", "lambda": "λ", "mu": "μ", "sigma": "σ", "Sigma": "Σ", "sum": "Σ", "to": "→",
               "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥", "in": "∈", "cdot": "·", "times": "×",
               "approx": "≈", "neq": "≠", "infty": "∞", "partial": "∂"}


def plain_tex(tex: str) -> str:
    """Формула → читаемый текст для сниппетов поиска: \\frac{a}{b} → a/b, \\mathrm{DCG} → DCG, \\alpha → α."""
    tex = re.sub(r"\\(?:mathrm|text|textit|mathbf|mathcal|mathit|operatorname|boldsymbol)\{([^{}]*)\}", r"\1", tex)
    tex = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"(\1)/(\2)", tex)
    tex = re.sub(r"\\[a-zA-Z]+", lambda m: TEX_SYMBOLS.get(m[0][1:], m[0][1:] if m[0][1:] in
                 ("log", "ln", "exp", "max", "min", "arg", "sin", "cos") else ""), tex)
    return " ".join(re.sub(r"[{}]|\\.", " ", tex).split()).replace("_ ", "_").replace("^ ", "^")


class SectionText(HTMLParser):
    """Текст страницы лекции по разделам level2/level3 (для поиска). Текст вне разделов — в раздел с id ""."""
    SKIP = {"nav", "aside", "script", "style", "button", "header"}

    def __init__(self) -> None:
        super().__init__()
        self.sections = [{"id": "", "h": "", "t": []}]
        self.stack: list[dict | None] = []  # открытые <section>: раздел для поиска или None
        self.in_main = self.skip = self.in_h = 0
        self.math: list[str] | None = None  # текст текущей формулы

    def current(self) -> dict:
        return next((s for s in reversed(self.stack) if s), self.sections[0])

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "main":
            self.in_main += 1
        elif tag in self.SKIP:
            self.skip += 1
        elif tag == "section":
            cls = (a.get("class") or "").split()
            sec = {"id": a.get("id", ""), "h": "", "t": []} if {"level2", "level3"} & set(cls) else None
            if sec:
                self.sections.append(sec)
            self.stack.append(sec)
        elif tag in ("h2", "h3") and self.stack and self.stack[-1]:
            self.in_h += 1
        elif tag == "span" and "math" in (a.get("class") or "").split():
            self.math = []

    def handle_endtag(self, tag):
        if tag == "main":
            self.in_main -= 1
        elif tag in self.SKIP:
            self.skip -= 1
        elif tag == "section" and self.stack:
            self.stack.pop()
        elif tag in ("h2", "h3") and self.in_h:
            self.in_h -= 1
        elif tag == "span" and self.math is not None:
            tex, self.math = "".join(self.math), None
            self.handle_data(f" {plain_tex(tex)} ")

    def handle_data(self, data):
        if self.math is not None:
            self.math.append(data)
        elif self.in_main and not self.skip:
            sec = self.current()
            if self.in_h:
                sec["h"] += data
            else:
                sec["t"].append(data)


def section_index(page: Path) -> list[list[str]]:
    parser = SectionText()
    parser.feed(page.read_text())
    out = []
    for sec in parser.sections:
        heading = re.sub(r"^[\d.]+\s+", "", " ".join(sec["h"].split()))
        text = " ".join("".join(sec["t"]).split())
        if heading or text:
            out.append([sec["id"], heading, text])
    return out


def write_pwa() -> None:
    """Манифест и service worker; версия кэша — хэш содержимого сайта."""
    for f in ("icon.svg", "icon-192.png", "icon-512.png"):
        shutil.copy2(SITE / f, OUT / "assets" / f)
    (OUT / "manifest.webmanifest").write_text(json.dumps({
        "name": "Конспекты лекций", "short_name": "Конспекты", "lang": "ru",
        "start_url": "./", "scope": "./", "display": "standalone",
        "background_color": "#fbfaf7", "theme_color": "#2f6db5",
        "icons": [{"src": f"assets/icon-{n}.png", "sizes": f"{n}x{n}", "type": "image/png", "purpose": "any maskable"}
                  for n in (192, 512)],
    }, ensure_ascii=False, indent=1))
    digest = hashlib.sha256()
    for f in sorted(OUT.rglob("*")):
        if f.is_file() and f.suffix != ".pdf":
            digest.update(f.read_bytes())
    (OUT / "sw.js").write_text((SITE / "sw.js").read_text().replace("__VERSION__", digest.hexdigest()[:12]))


def main() -> None:
    courses = tomllib.loads((ROOT / "courses.toml").read_text())["courses"].values()
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    for f in ("style.css", "app.js"):
        shutil.copy2(SITE / f, OUT / "assets" / f)

    sections, search = [], {"lectures": [], "sections": []}
    for course in courses:
        cdir = CONTENT / course["slug"]
        dirs = sorted((d for d in cdir.iterdir() if (d / "summary.md").exists()), key=lambda d: int(d.name)) \
            if cdir.exists() else []
        lectures = [read_lecture(d) for d in dirs]
        if not lectures:
            continue
        for i, lec in enumerate(lectures):
            build_lecture(course, lec, lectures[i - 1] if i else None,
                          lectures[i + 1] if i + 1 < len(lectures) else None)
            print(f"{course['slug']}/{lec['num']}")
            search["lectures"].append([f"{course['slug']}/{lec['num']}/", course["title"],
                                       f"Лекция {lec['num']}. {lec['title']}"])
            li = len(search["lectures"]) - 1
            page_html = OUT / course["slug"] / str(lec["num"]) / "index.html"
            search["sections"] += [[li, *sec] for sec in section_index(page_html)]

        title = html.escape(course["title"])
        color = course.get("color", "")
        count = f"{len(lectures)} {'лекция' if len(lectures) == 1 else 'лекции' if len(lectures) < 5 else 'лекций'}"
        (OUT / course["slug"] / "index.html").write_text(page(course["title"], "../", f"""
<p class="kicker">Курс · {count}</p>
<h1>{title}</h1>
{lecture_list(lectures, "")}""", color))
        sections.append(f'<section class="course" style="--course: {color}">\n'
                        f'<h2><a href="{course["slug"]}/">{title}</a><span class="count">{count}</span></h2>\n'
                        f'{lecture_list(lectures, course["slug"] + "/")}\n</section>')

    (OUT / "index.html").write_text(page("Конспекты лекций", "", f"""
<h1>Конспекты лекций</h1>
<p class="lead">Конспекты по записям лекций: текст вместо видео, схемы со слайдов, таймкоды и глоссарий.</p>
{"".join(sections)}"""))
    (OUT / "search.json").write_text(json.dumps(search, ensure_ascii=False, separators=(",", ":")))
    write_pwa()


if __name__ == "__main__":
    main()
