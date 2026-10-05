#!/usr/bin/env python3
"""Собирает сайт из content/ в _site/: страницы лекций и лабораторных (pandoc), страницы курсов и главную.

Папка content/<курс>/<N>/ — лекция, content/<курс>/lab<N>/ — учебник к лабораторной (doc-kind: lab).

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
GF = "https://fonts.googleapis.com/css2?"
FONTS = GF + "family=PT+Sans:wght@400;700&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap"
ONEST = "family=Onest:wght@400;600;700"
# Оформления (см. site/looks.css) и их шрифты; грузятся только шрифты выбранного. Первое — по умолчанию.
LOOK_FONTS = {
    "book": "family=Spectral:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Sans+Condensed:wght@500;700",
    "term": f"family=JetBrains+Mono:wght@400;700&{ONEST}",
    "mag": f"family=Unbounded:wght@500;800&{ONEST}",
    "swiss": "family=Golos+Text:wght@400;600;800",
    "cards": f"family=Manrope:wght@600;800&{ONEST}",
}


def look_script() -> str:
    fonts = json.dumps({k: f"{GF}{v}&display=swap" for k, v in LOOK_FONTS.items()})
    return ("window.LOOK_FONTS=" + fonts + ";(function(){var d=document.documentElement,s={};"
            "try{s=localStorage}catch(e){}"
            "function g(k){try{return s.getItem(k)}catch(e){return null}}"
            '["theme","fs","review"].forEach(function(k){var v=g(k);if(v)d.dataset[k]=v});'
            f'var l=g("look");if(!LOOK_FONTS[l])l="{next(iter(LOOK_FONTS))}";d.dataset.look=l;'
            'var f=document.createElement("link");f.rel="stylesheet";f.href=LOOK_FONTS[l];f.id="look-fonts";'
            "document.head.appendChild(f)})()")


def head(root: str) -> str:
    """Общая часть <head>. Инлайн-скрипт применяет настройки чтения до отрисовки, чтобы не было вспышки."""
    return f"""<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2f6db5">
<script>{look_script()}</script>
<link rel="manifest" href="{root}manifest.webmanifest">
<link rel="icon" href="{root}assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{root}assets/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<noscript><link rel="stylesheet" href="{FONTS}"></noscript>
<link rel="stylesheet" href="{root}assets/style.css">
<link rel="stylesheet" href="{root}assets/looks.css">
<script defer src="{root}assets/app.js"></script>"""


def read_lecture(d: Path) -> dict:
    text = (d / "summary.md").read_text()
    head = text.split("\n---", 1)[0]

    def field(key: str) -> str:
        m = re.search(rf'^{key}:\s*"?(.*?)"?\s*$', head, re.M)
        return m[1] if m else ""

    duration = re.search(r"Запись\s+([\d:]+)", field("meta-line"))
    minutes = max(1, round(len(re.findall(r"\w+", text)) / 180))
    lab, num = re.fullmatch(r"(lab)?(\d+)", d.name).groups()
    kind = "lab" if lab else "lecture"
    label = field(kind) or f"{'Лабораторная работа' if lab else 'Лекция'} {num}"
    return {
        "num": int(num), "kind": kind, "label": label, "dir": d, "title": field("title"),
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
    parts = [l["label"]] + ([f"запись {l['duration']}"] if l["duration"] else []) + [l["reading"]]
    return " · ".join(parts)


def lecture_list(lectures: list[dict], prefix: str) -> str:
    items = "\n".join(
        f'<li><a href="{prefix}{l["dir"].name}/" data-n="{l["num"]:02d}">'
        f'<span class="num">{meta(l)}</span>'
        f'<span class="t">{html.escape(l["title"])}</span>'
        "</a></li>"
        for l in lectures
    )
    return f'<ol class="lectures">\n{items}\n</ol>'


def src_name(lec: dict) -> str:
    return lec["dir"].name


def plural(n: int, one: str, few: str, many: str) -> str:
    form = one if n % 10 == 1 and n % 100 != 11 else few if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else many
    return f"{n} {form}"


def count_label(lectures: list[dict]) -> str:
    n_lec = sum(l["kind"] == "lecture" for l in lectures)
    n_lab = len(lectures) - n_lec
    parts = ([plural(n_lec, "лекция", "лекции", "лекций")] if n_lec else []) + \
            ([plural(n_lab, "лабораторная", "лабораторные", "лабораторных")] if n_lab else [])
    return " · ".join(parts)


def build_lecture(course: dict, lec: dict, prev: dict | None, nxt: dict | None) -> None:
    src, dst = lec["dir"], OUT / course["slug"] / src_name(lec)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("summary.md"))
    args = [
        "pandoc", str(src / "summary.md"), "-f", "markdown", "-t", "html5",
        "--standalone", "--template", str(SITE / "lecture.html"),
        "--lua-filter", str(SITE / "conspect.lua"),
        "--katex", "--section-divs", "--number-sections",
        "--toc", "--toc-depth=2",
        "-V", "root=../../", "-V", f"course-slug={course['slug']}",
        "-V", f"course-title={course['title']}", "-V", f"course-color={course.get('color', '')}",
        "-V", f"label={lec['label']}", "-V", f"kind={lec['kind']}", "-V", f"reading={lec['reading']}", "-V", f"minutes={lec['minutes']}", "-V", f"num={lec['num']:02d}",
        "-V", f"head={head('../../')}",
        "-o", str(dst / "index.html"),
    ]
    if (src / "conspect.pdf").exists():
        args += ["-V", "pdf=1"]
    if "```mermaid" in (src / "summary.md").read_text():
        args += ["-V", "mermaid=1"]
    for name, other in (("prev", prev), ("next", nxt)):
        if other:
            args += ["-V", f"{name}-href=../{src_name(other)}/", "-V", f"{name}-title={other['title']}"]
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
        self.in_mermaid = False  # исходник схемы — не текст

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
        elif tag == "pre" and "mermaid" in (a.get("class") or "").split():
            self.skip += 1
            self.in_mermaid = True

    def handle_endtag(self, tag):
        if tag == "main":
            self.in_main -= 1
        elif tag in self.SKIP:
            self.skip -= 1
        elif tag == "section" and self.stack:
            self.stack.pop()
        elif tag in ("h2", "h3") and self.in_h:
            self.in_h -= 1
        elif tag == "pre" and self.in_mermaid:
            self.skip -= 1
            self.in_mermaid = False
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
    for f in ("style.css", "looks.css", "app.js"):
        shutil.copy2(SITE / f, OUT / "assets" / f)

    sections, search = [], {"lectures": [], "sections": []}
    for course in courses:
        cdir = CONTENT / course["slug"]
        dirs = [d for d in cdir.iterdir() if (d / "summary.md").exists()] if cdir.exists() else []
        # сначала лекции, потом лабораторные, внутри — по номеру
        lectures = sorted((read_lecture(d) for d in dirs), key=lambda l: (l["kind"] == "lab", l["num"]))
        if not lectures:
            continue
        for i, lec in enumerate(lectures):
            build_lecture(course, lec, lectures[i - 1] if i else None,
                          lectures[i + 1] if i + 1 < len(lectures) else None)
            path = f"{course['slug']}/{src_name(lec)}"
            print(path)
            search["lectures"].append([f"{path}/", course["title"], f"{lec['label']}. {lec['title']}"])
            li = len(search["lectures"]) - 1
            page_html = OUT / path / "index.html"
            search["sections"] += [[li, *sec] for sec in section_index(page_html)]

        title = html.escape(course["title"])
        color = course.get("color", "")
        count = count_label(lectures)
        (OUT / course["slug"] / "index.html").write_text(page(course["title"], "../", f"""
<p class="kicker">Курс · {count}</p>
<h1>{title}</h1>
{lecture_list(lectures, "")}""", color))
        sections.append(f'<section class="course" style="--course: {color}">\n'
                        f'<h2><a href="{course["slug"]}/">{title}</a><span class="count">{count}</span></h2>\n'
                        f'{lecture_list(lectures, course["slug"] + "/")}\n</section>')

    (OUT / "index.html").write_text(page("Конспекты лекций", "", f"""
<h1>Конспекты лекций</h1>
<p class="lead">Конспекты по записям лекций: текст вместо видео, схемы со слайдов, таймкоды и глоссарий.
Учебники к защите лабораторных: по разделу на каждый вопрос.</p>
{"".join(sections)}"""))
    (OUT / "search.json").write_text(json.dumps(search, ensure_ascii=False, separators=(",", ":")))
    write_pwa()


if __name__ == "__main__":
    main()
