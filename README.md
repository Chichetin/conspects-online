# conspects-online

Сайт с конспектами лекций и учебниками к защите лабораторных, которые делает [text-extractor](https://github.com/Chichetin/video-lecture-to-conspect).
Публикуется на GitHub Pages: https://chichetin.github.io/conspects-online/

## Как обновить

```bash
python sync.py          # забрать последние версии из ../text-extractor
python build.py         # необязательно: собрать локально в _site/
python -m http.server -d _site
git add content && git commit -m "Обновить конспекты" && git push
```

После push GitHub Actions соберёт сайт и задеплоит его.

Шаги `/lecture` и `/lab` в text-extractor сами запускают `sync.py` и предлагают коммит и push.

- `sync.py` для каждой лекции берёт папку `lectures/<префикс><номер>[_vN]` с наибольшим N
  и копирует `summary.md`, использованные картинки и PDF из `output/` в `content/<курс>/<номер>/`.
  Лабораторная — папка `lectures/` или `labs/` вида `<префикс>_lab<номер>[_vN]`: её `primer.md`
  копируется в `content/<курс>/lab<номер>/summary.md`, PDF — `output/<папка>_questions.pdf`.
  Без PDF на странице вместо кнопки — «PDF пока недоступен».
- `courses.toml` сопоставляет префикс папки курсу. Новый курс — новая запись там.
- `build.py` собирает HTML через pandoc (`site/lecture.html`, `site/conspect.lua`), формулы рендерит KaTeX.
  Для лабораторных фильтр понимает разметку `/lab`: GitHub-плашки `> [!NOTE]` и т. п., якоря `#qN`,
  «Плохо / Хорошо», схемы Mermaid (рисуются в браузере через mermaid.js с jsDelivr).
  Заодно пишет поисковый индекс `search.json` (текст по разделам) и `sw.js` с версией кэша для офлайна.
- `site/app.js` — всё интерактивное: поиск, настройки чтения, прогресс и место чтения (в `localStorage`),
  карточки глоссария и сносок, просмотр картинок, режим «Быстро повторить» (что в нём остаётся,
  размечает класс `rv` в `conspect.lua`). Без JS страницы читаются как обычный HTML.
- `site/looks.css` — оформления на выбор в меню «Aa»: Учебник (по умолчанию), Терминал, Журнал,
  Швейцарский, Карточки. Шрифты каждого — `LOOK_FONTS` в `build.py`; грузятся только для выбранного.

Нужны Python ≥ 3.11 и pandoc ≥ 3.
