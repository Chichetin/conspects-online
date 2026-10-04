#!/usr/bin/env python3
"""Собирает сайт из content/ в _site/: страницы лекций (pandoc), страницы курсов и главную.

    python build.py
    python -m http.server -d _site   # предпросмотр
"""
import html
import re
import shutil
import subprocess
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
SITE = ROOT / "site"
OUT = ROOT / "_site"
FONTS = ("https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700"
         "&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap")


def read_lecture(d: Path) -> dict:
    text = (d / "summary.md").read_text()
    head = text.split("\n---", 1)[0]

    def field(key: str) -> str:
        m = re.search(rf'^{key}:\s*"?(.*?)"?\s*$', head, re.M)
        return m[1] if m else ""

    abstract = re.search(r"^::: \{\.abstract[^}]*\}\n(.+?)\n", text, re.M)
    teaser = ""
    if abstract:  # первые предложения аннотации, не короче 80 символов
        for sentence in re.split(r"(?<=[.!?])\s", abstract[1]):
            teaser = f"{teaser} {sentence}".strip()
            if len(teaser) >= 80:
                break
    duration = re.search(r"Запись\s+([\d:]+)", field("meta-line"))
    words = len(re.findall(r"\w+", text))
    return {
        "num": int(d.name), "dir": d, "title": field("title"), "teaser": teaser,
        "duration": duration[1] if duration else "",
        "reading": f"{max(1, round(words / 180))} мин чтения",
    }


def page(title: str, root: str, body: str, color: str = "") -> str:
    style = f' style="--course: {color}"' if color else ""
    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{html.escape(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="{root}assets/style.css">
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
        + (f'<span class="teaser">{html.escape(l["teaser"])}</span>' if l["teaser"] else "")
        + "</a></li>"
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
        "-V", f"reading={lec['reading']}",
        "-o", str(dst / "index.html"),
    ]
    if (src / "conspect.pdf").exists():
        args += ["-V", "pdf=1"]
    for name, other in (("prev", prev), ("next", nxt)):
        if other:
            args += ["-V", f"{name}-href=../{other['num']}/", "-V", f"{name}-title={other['title']}"]
    subprocess.run(args, check=True)


def main() -> None:
    courses = tomllib.loads((ROOT / "courses.toml").read_text())["courses"].values()
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    for f in ("style.css", "app.js"):
        shutil.copy2(SITE / f, OUT / "assets" / f)

    sections = []
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


if __name__ == "__main__":
    main()
