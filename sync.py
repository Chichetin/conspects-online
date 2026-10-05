#!/usr/bin/env python3
"""Копирует последние версии конспектов и учебников к лабораторным из text-extractor в content/.

Папки в lectures/ и labs/: лекция — <префикс><номер>[_v<N>] (результат /lecture, summary.md),
лабораторная — <префикс>_lab<номер>[_v<N>] (результат /lab, primer.md). Для каждой берётся версия
с наибольшим N (без суффикса — v1). В content/<slug курса>/<номер>/ (лабораторная — lab<номер>/)
кладутся summary.md (пути к картинкам переписаны на figures/), использованные картинки и PDF, если он есть.

    python sync.py [путь к text-extractor]   # по умолчанию ../text-extractor
"""
import re
import shutil
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
DIR_RE = re.compile(r"^([a-z]+)(_lab)?(\d+)(?:_v(\d+))?$")
# вид → (исходный markdown, суффикс PDF в output/, префикс папки на сайте)
KINDS = {"lecture": ("summary.md", "conspect", ""), "lab": ("primer.md", "questions", "lab")}
FIG_RE = re.compile(r"\]\(work/figures/([^)\s]+)\)")


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "text-extractor"
    courses = tomllib.loads((ROOT / "courses.toml").read_text())["courses"]

    latest: dict[tuple[str, str, int], tuple[int, Path]] = {}
    dirs = [d for sub in ("lectures", "labs") if (src / sub).is_dir() for d in sorted((src / sub).iterdir())]
    for d in dirs:
        m = DIR_RE.match(d.name)
        kind = "lab" if m and m[2] else "lecture"
        if not d.is_dir() or not m or not (d / KINDS[kind][0]).exists():
            continue
        prefix, num, ver = m[1], int(m[3]), int(m[4] or 1)
        if prefix not in courses:
            sys.exit(f"Неизвестный префикс курса «{prefix}» у {d.name}: добавьте его в courses.toml")
        key = (prefix, kind, num)
        if key not in latest or ver > latest[key][0]:
            latest[key] = (ver, d)

    for (prefix, kind, num), (ver, d) in sorted(latest.items()):
        md, pdf_suffix, dir_prefix = KINDS[kind]
        dst = CONTENT / courses[prefix]["slug"] / f"{dir_prefix}{num}"
        if dst.exists():
            shutil.rmtree(dst)
        (dst / "figures").mkdir(parents=True)

        text = (d / md).read_text()
        for name in sorted(set(FIG_RE.findall(text))):
            shutil.copy2(d / "work" / "figures" / name, dst / "figures" / name)
        (dst / "summary.md").write_text(FIG_RE.sub(r"](figures/\1)", text))

        pdf = src / "output" / f"{d.name}_{pdf_suffix}.pdf"
        if pdf.exists():
            shutil.copy2(pdf, dst / "conspect.pdf")
        else:
            print(f"  ! нет PDF {pdf.name} — на сайте будет «PDF пока недоступен»")
        print(f"{d.name} → {dst.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
