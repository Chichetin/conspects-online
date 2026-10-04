# conspects-online

Сайт с конспектами лекций, которые делает [text-extractor](https://github.com/Chichetin/video-lecture-to-conspect).
Публикуется на GitHub Pages: https://chichetin.github.io/conspects-online/

## Как обновить

```bash
python sync.py          # забрать последние версии из ../text-extractor
python build.py         # необязательно: собрать локально в _site/
python -m http.server -d _site
git add content && git commit -m "Обновить конспекты" && git push
```

После push GitHub Actions соберёт сайт и задеплоит его.

- `sync.py` для каждой лекции берёт папку `lectures/<префикс><номер>[_vN]` с наибольшим N
  и копирует `summary.md`, использованные картинки и PDF из `output/` в `content/<курс>/<номер>/`.
- `courses.toml` сопоставляет префикс папки курсу. Новый курс — новая запись там.
- `build.py` собирает HTML через pandoc (`site/lecture.html`, `site/conspect.lua`), формулы рендерит KaTeX.
  Заодно пишет поисковый индекс `search.json` (текст по разделам) и `sw.js` с версией кэша для офлайна.
- `site/app.js` — всё интерактивное: поиск, настройки чтения, прогресс и место чтения (в `localStorage`),
  карточки глоссария и сносок, просмотр картинок, режим «Быстро повторить» (что в нём остаётся,
  размечает класс `rv` в `conspect.lua`). Без JS страницы читаются как обычный HTML.

Нужны Python ≥ 3.11 и pandoc ≥ 3.
