#!/usr/bin/env python3
"""Копирует последние версии конспектов из text-extractor в content/.

Для каждой папки lectures/<префикс><номер>[_v<N>] берётся версия с наибольшим N
(без суффикса — v1). В content/<slug курса>/<номер>/ кладутся summary.md
(пути к картинкам переписаны на figures/), использованные картинки и PDF.

    python sync.py [путь к text-extractor]   # по умолчанию ../text-extractor
"""
import re
import shutil
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
DIR_RE = re.compile(r"^([a-z]+)(\d+)(?:_v(\d+))?$")
FIG_RE = re.compile(r"\]\(work/figures/([^)\s]+)\)")


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "text-extractor"
    courses = tomllib.loads((ROOT / "courses.toml").read_text())["courses"]

    latest: dict[tuple[str, int], tuple[int, Path]] = {}
    for d in sorted((src / "lectures").iterdir()):
        m = DIR_RE.match(d.name)
        if not d.is_dir() or not m or not (d / "summary.md").exists():
            continue
        prefix, num, ver = m[1], int(m[2]), int(m[3] or 1)
        if prefix not in courses:
            sys.exit(f"Неизвестный префикс курса «{prefix}» у {d.name}: добавьте его в courses.toml")
        key = (prefix, num)
        if key not in latest or ver > latest[key][0]:
            latest[key] = (ver, d)

    for (prefix, num), (ver, d) in sorted(latest.items()):
        dst = CONTENT / courses[prefix]["slug"] / str(num)
        if dst.exists():
            shutil.rmtree(dst)
        (dst / "figures").mkdir(parents=True)

        text = (d / "summary.md").read_text()
        for name in sorted(set(FIG_RE.findall(text))):
            shutil.copy2(d / "work" / "figures" / name, dst / "figures" / name)
        (dst / "summary.md").write_text(FIG_RE.sub(r"](figures/\1)", text))

        pdf = src / "output" / f"{d.name}_conspect.pdf"
        if pdf.exists():
            shutil.copy2(pdf, dst / "conspect.pdf")
        else:
            print(f"  ! нет PDF {pdf.name}")
        print(f"{d.name} → {dst.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
