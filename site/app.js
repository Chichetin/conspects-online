// Поведение сайта. Всё здесь необязательно: без JS страницы читаются как обычный HTML.
"use strict";

const ROOT = new URL("../", document.currentScript.src);
const doc = document.documentElement;
const body = document.body;
const isLecture = body.classList.contains("lecture-page");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const touch = matchMedia("(pointer: coarse)");
const narrow = matchMedia("(max-width: 699px)");

// localStorage может быть недоступен (приватный режим, запрет cookies) — тогда просто ничего не помним.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  json(k) { try { return JSON.parse(this.get(k)); } catch { return null; } },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const norm = (s) => s.toLowerCase().replaceAll("ё", "е");
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pagePath = (url) => new URL(url, location.href).pathname.replace(/index\.html$/, "");

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

const ICONS = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
};

let toastTimer;
function toast(message) {
  const t = document.querySelector(".toast") || body.appendChild(el("div", { class: "toast", role: "status" }));
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// Полноэкранные окна (поиск, картинка) закрываются системной кнопкой «назад».
function closeOnBack(close) {
  history.pushState({ modal: true }, "");
  const onPop = () => close(false);
  addEventListener("popstate", onPop, { once: true });
  return (rewind = true) => {
    removeEventListener("popstate", onPop);
    if (rewind && history.state?.modal) history.back();
  };
}

// ---------- шапка: прячется при прокрутке вниз ----------

const bar = document.querySelector(".site-bar");
const panels = []; // выпадающие панели: { panel, button }
let barHidden = false;

function setBarHidden(hidden) {
  if (panels.some((p) => p.panel.classList.contains("open"))) hidden = false;
  barHidden = hidden;
  body.classList.toggle("bar-hidden", hidden);
}

let lastY = scrollY;
let travel = 0; // путь в текущем направлении, чтобы шапка не дёргалась на мелких движениях
function updateBar() {
  const y = scrollY;
  const dy = y - lastY;
  lastY = y;
  if (Math.sign(dy) !== Math.sign(travel)) travel = 0;
  travel += dy;
  if (y < 80) setBarHidden(false);
  else if (travel > 40) setBarHidden(true);
  else if (travel < -40) setBarHidden(false);
}

const onScroll = [updateBar];
let ticking = false;
addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    onScroll.forEach((f) => f());
  });
}, { passive: true });

// ---------- выпадающие панели (оглавление, настройки) ----------

function addPanel(panel, button) {
  const p = { panel, button };
  panels.push(p);
  button.addEventListener("click", () => togglePanel(p));
  return p;
}

function togglePanel(p, open = !p.panel.classList.contains("open")) {
  if (open) panels.forEach((q) => q !== p && togglePanel(q, false));
  p.panel.classList.toggle("open", open);
  p.button.setAttribute("aria-expanded", String(open));
  if (open) setBarHidden(false);
}

document.addEventListener("click", (e) => {
  for (const p of panels) {
    if (p.panel.classList.contains("open") && !p.panel.contains(e.target) && !p.button.contains(e.target)) {
      togglePanel(p, false);
    }
  }
});

// ---------- шапка: поиск и настройки чтения ----------

const searchButton = el("button", { class: "icon-btn", type: "button", "aria-label": "Поиск", title: "Поиск (/)", html: ICONS.search });
const settingsButton = el("button", {
  class: "icon-btn aa", type: "button", "aria-label": "Настройки чтения", title: "Настройки чтения",
  "aria-controls": "settings", "aria-expanded": "false", text: "Aa",
});
bar.append(el("div", { class: "bar-tools" }, searchButton, settingsButton));

const FONT_STEPS = ["-1", "0", "1", "2"];
const THEMES = [["auto", "Авто"], ["light", "Светлая"], ["dark", "Тёмная"]];
// оформления из looks.css; превью «Аа» рисуется шрифтом и цветами самого оформления
const LOOKS = [
  { id: "book", name: "Учебник", font: "Spectral:wght@600", family: "Spectral, serif", bg: "#fffefb", fg: "#1c1a17", accent: "#7b1e2c", radius: "2px" },
  { id: "term", name: "Терминал", font: "JetBrains+Mono:wght@700", family: "'JetBrains Mono', monospace", bg: "#0d1117", fg: "#c9d1d9", accent: "#7ee787", radius: "6px" },
  { id: "mag", name: "Журнал", font: "Unbounded:wght@800", family: "Unbounded, sans-serif", bg: "#1d3fbf", fg: "#ffffff", accent: "#ffd84a", radius: "0" },
  { id: "swiss", name: "Швейцарский", font: "Golos+Text:wght@800", family: "'Golos Text', sans-serif", bg: "#ffffff", fg: "#0a0a0a", accent: "#e2001a", radius: "0" },
  { id: "cards", name: "Карточки", font: "Manrope:wght@800", family: "Manrope, sans-serif", bg: "#edf0f5", fg: "#1b1f27", accent: "#2f6db5", radius: "14px" },
];

function setLook(id) {
  doc.dataset.look = id;
  store.set("look", id);
  const fonts = document.getElementById("look-fonts");
  if (fonts && window.LOOK_FONTS?.[id]) fonts.href = LOOK_FONTS[id];
  renderSettings();
}

function setPref(key, value, fallback) {
  if (value === fallback) delete doc.dataset[key];
  else doc.dataset[key] = value;
  store.set(key, value === fallback ? null : value);
  renderSettings();
}

const fontMinus = el("button", { type: "button", "aria-label": "Мельче", text: "A−" });
const fontPlus = el("button", { type: "button", "aria-label": "Крупнее", text: "A+" });
const fontLevel = el("span", { class: "fs-level" });
const themeButtons = THEMES.map(([value, label]) =>
  el("button", { type: "button", text: label, onclick: () => setPref("theme", value, "auto"), "data-value": value }));
const lookButtons = LOOKS.map((l) => el("button", {
  type: "button", class: "look", "data-value": l.id, onclick: () => setLook(l.id),
  style: `--l-bg: ${l.bg}; --l-fg: ${l.fg}; --l-accent: ${l.accent}; --l-font: ${l.family}; --l-radius: ${l.radius}`,
}, el("span", { class: "look-aa", text: "Аа" }), el("span", { class: "look-name", text: l.name })));
const reviewSwitch = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": "false" });

const settings = el("div", { class: "panel settings", id: "settings", role: "dialog", "aria-label": "Настройки чтения" },
  el("div", { class: "set-block" }, el("span", { text: "Оформление" }), el("div", { class: "looks" }, ...lookButtons)),
  el("div", { class: "set-row" }, el("span", { text: "Размер текста" }),
    el("div", { class: "seg" }, fontMinus, fontLevel, fontPlus)),
  el("div", { class: "set-row" }, el("span", { text: "Тема" }), el("div", { class: "seg" }, ...themeButtons)),
);
if (isLecture) {
  settings.append(el("label", { class: "set-row" }, el("span", { text: "Быстро повторить" }), reviewSwitch));
}
body.append(settings);
addPanel(settings, settingsButton);
settingsButton.addEventListener("click", () => {
  // для превью нужны только буквы «Аа» каждого шрифта — это несколько килобайт
  if (document.getElementById("look-previews")) return;
  document.head.append(el("link", {
    rel: "stylesheet", id: "look-previews",
    href: `https://fonts.googleapis.com/css2?${LOOKS.map((l) => `family=${l.font}`).join("&")}&text=${encodeURIComponent("Аа")}&display=swap`,
  }));
});

function stepFont(delta) {
  const i = clamp(FONT_STEPS.indexOf(doc.dataset.fs || "0") + delta, 0, FONT_STEPS.length - 1);
  setPref("fs", FONT_STEPS[i], "0");
}
fontMinus.addEventListener("click", () => stepFont(-1));
fontPlus.addEventListener("click", () => stepFont(1));

function renderSettings() {
  const i = FONT_STEPS.indexOf(doc.dataset.fs || "0");
  fontLevel.textContent = `${Math.round([93.75, 100, 112.5, 125][i])}%`;
  fontMinus.disabled = i === 0;
  fontPlus.disabled = i === FONT_STEPS.length - 1;
  const theme = doc.dataset.theme || "auto";
  themeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === theme)));
  lookButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === doc.dataset.look)));
}
renderSettings();

// ---------- поиск по всем конспектам ----------

let searchIndex;
function loadIndex() {
  searchIndex ??= fetch(new URL("search.json", ROOT))
    .then((r) => r.json())
    .then((data) => {
      for (const s of data.sections) {
        s.nh = norm(s[2]);
        s.nt = norm(s[3]);
      }
      return data;
    });
  return searchIndex;
}

function highlight(text, words) {
  const n = norm(text);
  if (n.length !== text.length) return escapeHtml(text);
  const hit = new Uint8Array(text.length);
  for (const w of words) {
    for (let i = n.indexOf(w); i >= 0; i = n.indexOf(w, i + w.length)) hit.fill(1, i, i + w.length);
  }
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (hit[i] && !hit[i - 1]) out += "<mark>";
    out += escapeHtml(text[i]);
    if (hit[i] && !hit[i + 1]) out += "</mark>";
  }
  return out;
}

function snippet(s, words) {
  const text = s[3];
  let pos = -1;
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    pos = s.nt.indexOf(w);
    if (pos >= 0) break;
  }
  pos = Math.max(pos, 0);
  let start = Math.max(0, pos - 60);
  let end = Math.min(text.length, pos + 160);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  if (end < text.length) end = Math.max(text.lastIndexOf(" ", end), pos + 1);
  return (start > 0 ? "…" : "") + highlight(text.slice(start, end), words) + (end < text.length ? "…" : "");
}

function countIn(text, w) {
  let n = 0;
  for (let i = text.indexOf(w); i >= 0 && n < 5; i = text.indexOf(w, i + w.length)) n++;
  return n;
}

function runSearch(data, query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const found = [];
  for (const s of data.sections) {
    let score = 0;
    for (const w of words) {
      const inH = s.nh.includes(w);
      const inT = countIn(s.nt, w);
      if (!inH && !inT) { score = -1; break; }
      score += (inH ? 10 : 0) + inT;
    }
    if (score > 0) found.push([score, s]);
  }
  found.sort((a, b) => b[0] - a[0]);
  return { words, total: found.length, items: found.slice(0, 40).map(([, s]) => s) };
}

const searchInput = el("input", {
  type: "search", placeholder: "Поиск по конспектам", "aria-label": "Поиск по конспектам",
  enterkeyhint: "search", autocomplete: "off", spellcheck: "false",
});
const searchResults = el("div", { class: "search-results", "aria-live": "polite" });
const searchBox = el("div", { class: "search", role: "dialog", "aria-modal": "true", "aria-label": "Поиск", hidden: true },
  el("div", { class: "search-panel" },
    el("div", { class: "search-head" }, el("span", { class: "search-icon", html: ICONS.search }), searchInput,
      el("button", { type: "button", class: "search-close", text: "Закрыть", onclick: () => closeSearch() })),
    searchResults));
body.append(searchBox);

let searchRewind = null;
function openSearch() {
  if (!searchBox.hidden) return;
  searchBox.hidden = false;
  body.classList.add("no-scroll");
  searchInput.focus();
  searchInput.select();
  searchRewind = closeOnBack(closeSearch);
  renderResults();
}
function closeSearch(rewind = true) {
  if (searchBox.hidden) return;
  searchBox.hidden = true;
  body.classList.remove("no-scroll");
  searchRewind?.(rewind);
  searchRewind = null;
}

async function renderResults() {
  const query = searchInput.value;
  let data;
  try {
    data = await loadIndex();
  } catch {
    searchResults.innerHTML = '<p class="search-hint">Не удалось загрузить индекс поиска.</p>';
    return;
  }
  if (query !== searchInput.value) return; // пока грузилось, запрос поменялся
  const res = runSearch(data, query);
  if (!res) {
    searchResults.innerHTML = '<p class="search-hint">Ищет по тексту всех лекций и лабораторных. Например: <i>NDCG</i>, <i>retention</i>, <i>A/B-тест</i>.</p>';
    return;
  }
  if (!res.items.length) {
    searchResults.innerHTML = '<p class="search-hint">Ничего не найдено.</p>';
    return;
  }
  searchResults.replaceChildren(...res.items.map((s) => {
    const [href, course, lecture] = data.lectures[s[0]];
    const url = new URL(href, ROOT);
    if (s[1]) url.hash = encodeURIComponent(s[1]);
    return el("a", { class: "result", href: url.href, onclick: () => closeSearch(false) },
      el("span", { class: "result-where", text: `${course} · ${lecture}` }),
      el("span", { class: "result-title", html: highlight(s[2] || lecture, res.words) }),
      el("span", { class: "result-text", html: snippet(s, res.words) }));
  }));
  if (res.total > res.items.length) {
    searchResults.append(el("p", { class: "search-hint", text: `Показаны первые ${res.items.length} из ${res.total}. Уточните запрос.` }));
  }
}

let searchTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderResults, 120);
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchResults.querySelector(".result")?.click();
});
searchBox.addEventListener("click", (e) => {
  if (e.target === searchBox) closeSearch();
});
searchButton.addEventListener("click", openSearch);
searchButton.addEventListener("pointerenter", loadIndex, { once: true });

const lead = document.querySelector(".lead");
if (lead) {
  lead.after(el("button", { type: "button", class: "search-field", onclick: openSearch },
    el("span", { html: ICONS.search }), "Поиск по всем конспектам"));
}

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.closest("input, textarea, [contenteditable]")) {
    e.preventDefault();
    openSearch();
  } else if (e.key === "Escape") {
    if (!searchBox.hidden) closeSearch();
    panels.forEach((p) => togglePanel(p, false));
  }
});

// ---------- прогресс чтения: ключ — путь страницы лекции ----------

const posKey = (path) => `pos:${path}`;

if (!isLecture) {
  // на главной и на странице курса — отметки о прочитанном и «Продолжить» для последней начатой лекции;
  // кружок справа переключает лекцию «прочитана / нет» (полный пересчёт — при следующем открытии лекции)
  const DONE = 0.9;
  let last = null;
  function renderLecture(a, mark) {
    const saved = store.json(posKey(pagePath(a.href))) || {};
    const pct = saved.all ? 1 : saved.pct || 0;
    const done = pct >= DONE;
    a.classList.toggle("read-done", done);
    a.classList.toggle("read-some", pct >= 0.02 && !done);
    a.style.setProperty("--read", pct.toFixed(3));
    a.querySelector(".read")?.remove();
    if (pct >= 0.02) a.querySelector(".num").append(el("span", { class: "read", text: done ? "прочитано" : `прочитано ${Math.round(pct * 100)}%` }));
    mark.className = `read-mark${done ? " done" : pct > 0 ? " part" : ""}`;
    mark.style.setProperty("--f", pct.toFixed(3));
    mark.setAttribute("aria-label", `${a.querySelector(".t").textContent}: отметить ${done ? "непрочитанной" : "прочитанной"}`);
    mark.title = done ? "Прочитано · отметить непрочитанной" : "Отметить прочитанной";
    return { saved, done };
  }
  document.querySelectorAll(".lectures a").forEach((a) => {
    const mark = el("button", { type: "button" });
    a.after(mark);
    a.parentElement.classList.add("has-mark");
    mark.addEventListener("click", () => {
      const k = posKey(pagePath(a.href));
      const rec = store.json(k) || {};
      const done = (rec.all ? 1 : rec.pct || 0) >= DONE;
      delete rec.max;
      if (done) { delete rec.all; rec.read = {}; rec.pct = 0; } else { rec.all = true; rec.pct = 1; }
      store.set(k, JSON.stringify(rec));
      renderLecture(a, mark);
    });
    const { saved, done } = renderLecture(a, mark);
    if (saved.t && saved.p > 0.03 && !done && (!last || saved.t > last.saved.t)) last = { a, saved };
  });
  const anchor = document.querySelector(".search-field") || document.querySelector(".list-page h1");
  if (last && anchor) {
    const course = last.a.closest(".course");
    anchor.after(el("a", {
      class: "continue", href: last.a.href,
      style: course ? course.getAttribute("style") : "",
    }, el("span", { class: "ring", style: `--p: ${last.saved.pct || 0}` }),
    el("span", {}, "Продолжить чтение", el("b", { text: last.a.querySelector(".t").textContent }))));
  }
}

// ---------- service worker: офлайн-доступ ----------

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register(new URL("sw.js", ROOT)).catch(() => {});
}

if (isLecture) initLecture();

function initLecture() {
  const main = document.querySelector("main");
  const minutes = Number(body.dataset.minutes) || 0;
  const key = posKey(pagePath(location.href));

  // формулы
  if (window.katex) {
    document.querySelectorAll(".math").forEach((m) => {
      katex.render(m.textContent, m, { displayMode: m.classList.contains("display"), throwOnError: false });
    });
  }

  // ----- оглавление и подсветка текущего раздела -----
  const toc = document.getElementById("toc");
  const tocButton = document.getElementById("toc-button");
  const tocPanel = addPanel(toc, tocButton);
  toc.addEventListener("click", (e) => {
    if (e.target.closest("a")) togglePanel(tocPanel, false);
  });

  const links = new Map([...toc.querySelectorAll("a[href^='#']")].map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
  const sections = [...main.querySelectorAll("section.level2")].filter((s) => links.has(s.id));
  const allSections = [...main.querySelectorAll("section.level2[id], section.level3[id]")];
  const visible = (e) => e.offsetParent !== null;

  function sectionAt(list, line) {
    let current = null;
    for (const s of list) {
      if (visible(s) && s.getBoundingClientRect().top < line) current = s;
    }
    return current;
  }

  function updateActive() {
    const current = sectionAt(sections, innerHeight * 0.3) || sections.find(visible);
    links.forEach((a) => a.classList.remove("active"));
    if (current) links.get(current.id).classList.add("active");
  }
  onScroll.push(updateActive);
  updateActive();

  // ----- ссылки на разделы -----
  function sectionTitle(sec) {
    const h = sec.querySelector(":scope > h2, :scope > h3").cloneNode(true);
    h.querySelectorAll(".header-section-number, .anchor").forEach((x) => x.remove());
    return (sec.dataset.number ? `${sec.dataset.number}. ` : "") + h.textContent.trim();
  }

  main.querySelectorAll("section[id] > h2, section[id] > h3").forEach((h) => {
    const sec = h.parentElement;
    h.append(el("button", {
      type: "button", class: "anchor", "aria-label": "Ссылка на раздел", title: "Скопировать ссылку на раздел",
      html: ICONS.link,
      onclick: async () => {
        const url = `${location.origin}${location.pathname}#${encodeURIComponent(sec.id)}`;
        history.replaceState(history.state, "", `#${encodeURIComponent(sec.id)}`);
        if (touch.matches && navigator.share) {
          navigator.share({ title: `${sectionTitle(sec)} — ${document.title}`, url }).catch(() => {});
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          toast("Ссылка скопирована");
        } catch {
          toast("Ссылка — в адресной строке");
        }
      },
    }));
  });

  // ----- что прочитано -----
  // Текст делится на блоки (абзацы, пункты, картинки, таблицы). Блок засчитывается, когда пробыл в средней
  // части экрана ~40% времени, нужного на его чтение: при быстрой прокрутке он пролетает и не считается.
  // Время идёт, только пока вкладка видна, есть активность (≤ 90 с без действий) и не включён режим повторения.
  // Q&A, сноски и глоссарий — справочные, в прогресс не входят. Хранится: { раздел: [номера блоков] }.
  const WPM = 180;
  const BLOCK = "p, li, figure, table, blockquote, pre";
  const glossary = sections.filter((sec) => sectionTitle(sec).replace(/^[\d.]+\s*/, "") === "Глоссарий");
  const skip = (e) => e.closest("details.qa, .footnotes, .lecture-head, .secmeta, .pager, aside") || glossary.some((g) => g.contains(e));
  const candidates = [...main.querySelectorAll(BLOCK)].filter((e) => !skip(e));
  const candidateSet = new Set(candidates);
  const perSection = new Map();
  const blocks = candidates
    .filter((e) => ![...e.querySelectorAll(BLOCK)].some((x) => candidateSet.has(x))) // самые вложенные
    .map((e) => {
      const words = e.matches("figure, pre.mermaid") ? 15 : (e.textContent.match(/\S+/g) || []).length;
      const sec = e.closest("section[id]")?.id || "";
      const idx = perSection.get(sec) || 0;
      perSection.set(sec, idx + 1);
      return { el: e, sec, idx, words, need: Math.max(1500, (words / WPM) * 60000 * 0.4), acc: 0, read: false };
    })
    .filter((b) => b.words > 0);
  const byEl = new Map(blocks.map((b) => [b.el, b]));
  const totalWords = blocks.reduce((n, b) => n + b.words, 0) || 1;

  const saved = store.json(key) || {};
  if (saved.all) blocks.forEach((b) => { b.read = true; });
  else if (saved.read) blocks.forEach((b) => { b.read = Boolean(saved.read[b.sec]?.includes(b.idx)); });

  const share = (list) => {
    const all = list.reduce((n, b) => n + b.words, 0);
    return all ? list.reduce((n, b) => n + (b.read ? b.words : 0), 0) / all : 0;
  };
  const isDone = (f) => f >= 0.9;

  function persist() {
    const read = {};
    for (const b of blocks) if (b.read) (read[b.sec] ||= []).push(b.idx);
    const rec = store.json(key) || {};
    delete rec.all;
    delete rec.max;
    rec.read = read;
    rec.pct = Number(share(blocks).toFixed(3));
    rec.t = Date.now();
    store.set(key, JSON.stringify(rec));
  }

  // отметки: кружок у разделов в оглавлении и у заголовков; клик переключает «прочитано / нет»
  const marks = []; // { button, list, title }
  function markButton(list, title) {
    const button = el("button", { type: "button", class: "read-mark" });
    const m = { button, list, title };
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const done = isDone(share(list));
      list.forEach((b) => { b.read = !done; b.acc = 0; });
      persist();
      renderRead();
      toast(done ? "Отмечено непрочитанным" : "Отмечено прочитанным");
    });
    marks.push(m);
    return button;
  }

  links.forEach((a, id) => {
    const sec = document.getElementById(id);
    const list = blocks.filter((b) => sec?.contains(b.el));
    if (list.length) a.before(markButton(list, sectionTitle(sec)));
  });
  main.querySelectorAll("section[id] > h2, section[id] > h3").forEach((h) => {
    const list = blocks.filter((b) => h.parentElement.contains(b.el));
    if (list.length) h.append(markButton(list, sectionTitle(h.parentElement)));
  });

  function firstUnread() {
    return blocks.find((b) => !b.read && visible(b.el));
  }
  const readingLine = () => innerHeight * 0.25;
  const scrollToEl = (e, off = 0) => scrollTo({ top: e.getBoundingClientRect().top + scrollY + off - readingLine(), behavior: "auto" });

  const allButton = el("button", { type: "button" });
  toc.append(el("div", { class: "toc-actions" },
    el("button", {
      type: "button", text: "К непрочитанному",
      onclick: () => {
        const b = firstUnread();
        togglePanel(tocPanel, false);
        if (b) scrollToEl(b.el);
        else toast("Всё прочитано");
      },
    }),
    allButton));
  allButton.addEventListener("click", () => {
    const done = isDone(share(blocks));
    blocks.forEach((b) => { b.read = !done; b.acc = 0; });
    persist();
    renderRead();
    toast(done ? "Прогресс лекции сброшен" : "Лекция отмечена прочитанной");
  });

  // ----- док внизу: наверх · осталось N мин · содержание -----
  const progressBar = el("div", { class: "progress", "aria-hidden": "true" }, el("span"));
  const toTop = el("button", {
    type: "button", class: "dock-btn to-top", "aria-label": "Наверх", html: ICONS.up,
    onclick: () => scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" }),
  });
  const ring = el("span", { class: "ring", "aria-hidden": "true" });
  const remainingText = el("span", { class: "remaining-text" });
  const remaining = el("button", { type: "button", class: "dock-btn remaining" }, ring, remainingText);
  const dock = el("div", { class: "dock" }, toTop, remaining, tocButton);
  body.append(progressBar, dock);

  let remainingOff = store.get("remaining") === "off";
  remaining.addEventListener("click", () => {
    remainingOff = !remainingOff;
    store.set("remaining", remainingOff ? "off" : null);
    renderRead();
  });

  function progress() { // доля прокрутки — только для полосы сверху и места чтения
    const end = main.getBoundingClientRect().bottom + scrollY - innerHeight;
    return end > 0 ? clamp(scrollY / end, 0, 1) : 1;
  }

  function renderRead() {
    for (const m of marks) {
      const f = share(m.list);
      m.button.classList.toggle("done", isDone(f));
      m.button.classList.toggle("part", f > 0 && !isDone(f));
      m.button.style.setProperty("--f", f.toFixed(3));
      m.button.setAttribute("aria-label", `«${m.title}»: ${isDone(f) ? "прочитано" : f > 0 ? `прочитано ${Math.round(f * 100)}%` : "не прочитано"}. Нажмите, чтобы отметить ${isDone(f) ? "непрочитанным" : "прочитанным"}`);
      m.button.title = isDone(f) ? "Прочитано · отметить непрочитанным" : "Отметить прочитанным";
    }
    const pct = share(blocks);
    allButton.textContent = isDone(pct) ? "Сбросить прогресс" : "Отметить всё прочитанным";
    ring.style.setProperty("--p", pct);
    // в режиме повторения — сколько осталось из того, что показано
    const unread = blocks.reduce((n, b) => n + (!b.read && (!doc.dataset.review || visible(b.el)) ? b.words : 0), 0);
    const label = unread === 0 ? "прочитано" : `~${Math.max(1, Math.ceil(unread / WPM))} мин`;
    remainingText.textContent = label;
    remaining.classList.toggle("off", remainingOff);
    remaining.setAttribute("aria-label", remainingOff
      ? "Показать, сколько осталось читать"
      : `Осталось ${label}, прочитано ${Math.round(pct * 100)}%. Нажмите, чтобы скрыть`);
  }

  function updateProgress() {
    progressBar.firstChild.style.transform = `scaleX(${progress()})`;
    toTop.classList.toggle("show", !barHidden && scrollY > innerHeight * 1.5);
  }
  onScroll.push(updateProgress);
  addEventListener("resize", updateProgress);
  updateProgress();
  if (saved.all) persist();
  renderRead();

  const inZone = new Set();
  const zone = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const b = byEl.get(e.target);
      if (e.isIntersecting) inZone.add(b);
      else inZone.delete(b);
    }
  }, { rootMargin: "-15% 0px -15% 0px" });
  blocks.forEach((b) => zone.observe(b.el));

  let lastActive = Date.now();
  for (const type of ["scroll", "pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(type, () => { lastActive = Date.now(); }, { passive: true });
  }
  setInterval(() => {
    if (document.hidden || doc.dataset.review || body.classList.contains("no-scroll") || Date.now() - lastActive > 90000) return;
    let changed = false;
    for (const b of inZone) {
      if (!b.read && (b.acc += 1000) >= b.need) {
        b.read = true;
        changed = true;
      }
    }
    if (changed) {
      persist();
      renderRead();
    }
  }, 1000);

  // ----- место чтения: раздел + смещение, чтобы предложить продолжить -----
  let moved = false;
  const startY = scrollY;

  function savePosition() {
    if (!moved) return;
    const sec = sectionAt(allSections, readingLine());
    const rec = store.json(key) || {};
    Object.assign(rec, {
      id: sec ? sec.id : "",
      off: Math.round(sec ? readingLine() - sec.getBoundingClientRect().top : scrollY),
      p: Number(progress().toFixed(3)),
      t: Date.now(),
    });
    store.set(key, JSON.stringify(rec));
  }
  let saveTimer;
  onScroll.push(() => {
    if (Math.abs(scrollY - startY) > 100) moved = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 400);
  });
  addEventListener("pagehide", savePosition);
  document.addEventListener("visibilitychange", () => document.hidden && savePosition());

  const savedSection = saved.id ? document.getElementById(saved.id) : null;
  if (!location.hash && saved.p > 0.03 && !isDone(share(blocks)) && scrollY < 100 && (savedSection || !saved.id)) {
    const where = savedSection ? `с раздела «${sectionTitle(savedSection)}»` : "с места, где остановились";
    const unread = firstUnread();
    const unreadSection = unread?.el.closest("section[id]");
    const resume = el("div", { class: "resume", role: "status" },
      el("span", { class: "resume-text" }, `Продолжить ${where}?`,
        unread && unreadSection !== savedSection && !savedSection?.contains(unread.el)
          ? el("button", {
            type: "button", class: "resume-alt", text: "Или к первому непрочитанному",
            onclick: () => { hideResume(); scrollToEl(unread.el); },
          })
          : ""),
      el("button", {
        type: "button", class: "resume-go", text: "Продолжить",
        onclick: () => {
          hideResume();
          if (savedSection) scrollToEl(savedSection, saved.off);
          else scrollTo({ top: saved.off, behavior: "auto" });
        },
      }),
      el("button", { type: "button", class: "resume-close", "aria-label": "Закрыть", text: "×", onclick: () => hideResume() }));
    body.append(resume);
    requestAnimationFrame(() => resume.classList.add("show"));
    const hideResume = () => {
      const i = onScroll.indexOf(watchResume);
      if (i < 0) return;
      onScroll.splice(i, 1);
      resume.classList.remove("show");
      setTimeout(() => resume.remove(), 300);
    };
    const watchResume = () => scrollY > innerHeight && hideResume();
    onScroll.push(watchResume);
  }

  // ----- быстро повторить -----
  const reviewButton = document.getElementById("review-toggle");
  reviewButton.hidden = false;

  function setReview(on) {
    const anchor = scrollY > main.querySelector(".lecture-head").offsetHeight ? sectionAt(sections, innerHeight * 0.3) : null;
    if (on) doc.dataset.review = "1";
    else delete doc.dataset.review;
    store.set("review", on ? "1" : null);
    reviewButton.setAttribute("aria-pressed", String(on));
    reviewButton.textContent = on ? "Показать всё" : "Быстро повторить";
    reviewSwitch.setAttribute("aria-checked", String(on));
    links.forEach((a, id) => {
      const sec = document.getElementById(id);
      a.parentElement.hidden = on && sec && !visible(sec);
    });
    if (anchor) {
      const target = visible(anchor) ? anchor : sections.slice(sections.indexOf(anchor)).find(visible);
      target?.scrollIntoView();
    }
    updateActive();
    updateProgress();
    renderRead();
  }
  reviewButton.addEventListener("click", () => setReview(!doc.dataset.review));
  reviewSwitch.addEventListener("click", () => setReview(!doc.dataset.review));
  setReview(Boolean(doc.dataset.review));

  initPopovers();
  initLightbox();
  prefetchForOffline();
}

// ---------- глоссарий и сноски во всплывающей карточке ----------

function initPopovers() {
  const popBody = el("div", { class: "pop-body" });
  const pop = el("div", { class: "pop", role: "dialog", hidden: true },
    el("button", { type: "button", class: "pop-close", "aria-label": "Закрыть", text: "×", onclick: () => hidePop() }),
    popBody);
  body.append(pop);
  let anchor = null;
  let hoverTimer;

  function content(a) {
    const target = document.getElementById(decodeURIComponent(a.hash.slice(1)));
    if (!target) return null;
    if (a.classList.contains("gl")) {
      const row = target.closest("tr");
      return [
        el("div", { class: "pop-title", html: target.innerHTML }),
        el("div", { class: "pop-text", html: row.cells[1].innerHTML }),
        el("a", { class: "pop-more", href: a.hash, text: "В глоссарий →", onclick: () => hidePop() }),
      ];
    }
    const note = target.cloneNode(true);
    note.querySelectorAll(".footnote-back").forEach((x) => x.remove());
    return [el("div", { class: "pop-kicker", text: `Сноска ${a.textContent.trim()}` }), ...note.childNodes];
  }

  function place() {
    const sheet = narrow.matches || touch.matches;
    pop.classList.toggle("sheet", sheet);
    pop.style.left = pop.style.top = "";
    if (sheet) return;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${clamp(r.left, 8, innerWidth - w - 8) + scrollX}px`;
    const below = r.bottom + h + 8 < innerHeight || r.top < h + 8;
    pop.style.top = `${(below ? r.bottom + 6 : r.top - h - 6) + scrollY}px`;
  }

  function showPop(a, hover = false) {
    const nodes = content(a);
    if (!nodes) return false;
    anchor = a;
    popBody.replaceChildren(...nodes);
    pop.dataset.hover = hover ? "1" : "";
    pop.hidden = false;
    pop.style.transform = "";
    place();
    return true;
  }

  function hidePop() {
    pop.hidden = true;
    anchor = null;
  }

  const trigger = (t) => t.closest?.("a.gl, a.footnote-ref");

  document.addEventListener("click", (e) => {
    const a = trigger(e.target);
    if (a && (a !== anchor || pop.dataset.hover)) {
      if (showPop(a)) e.preventDefault();
    } else if (a) {
      e.preventDefault();
      hidePop();
    } else if (!pop.hidden && !pop.contains(e.target)) {
      hidePop();
    }
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && hidePop());
  addEventListener("resize", () => anchor && place());

  // на десктопе — по наведению, как раньше всплывала подсказка
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || narrow.matches) return;
    const a = trigger(e.target);
    if (a || pop.contains(e.target)) clearTimeout(hoverTimer);
    if (a && a !== anchor && (pop.hidden || pop.dataset.hover)) {
      hoverTimer = setTimeout(() => showPop(a, true), 250);
    }
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse" || !pop.dataset.hover) return;
    if (trigger(e.target) || pop.contains(e.target)) {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => pop.dataset.hover && hidePop(), 250);
    }
  });

  // на телефоне карточку снизу можно смахнуть вниз
  let startY = null;
  pop.addEventListener("touchstart", (e) => {
    startY = pop.classList.contains("sheet") && pop.scrollTop === 0 ? e.touches[0].clientY : null;
  }, { passive: true });
  pop.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    pop.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  pop.addEventListener("touchend", (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    if (dy > 80) hidePop();
    pop.style.transform = "";
  });
}

// ---------- картинки на весь экран: щипок, перетаскивание, двойной тап, колесо ----------

function initLightbox() {
  const img = el("img", { class: "lb-img", alt: "", draggable: "false" });
  const caption = el("div", { class: "lb-caption" });
  const box = el("div", { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Просмотр изображения", hidden: true },
    img, caption,
    el("button", { type: "button", class: "lb-close", "aria-label": "Закрыть", text: "×", onclick: () => close() }));
  body.append(box);

  let s = 1, tx = 0, ty = 0;
  const pointers = new Map();
  let start = null, moved = false, lastTap = 0, rewind = null;
  let downOnImage = false; // после setPointerCapture target у pointerup — сам оверлей

  function apply(animate = false) {
    img.style.transition = animate && !reduceMotion.matches ? "transform .2s" : "none";
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  // точка (px, py) на экране остаётся на месте при смене масштаба (transform-origin: 0 0)
  function zoomFrom(base, ns, px, py, qx = px, qy = py) {
    const ux = (px - img.offsetLeft - base.tx) / base.s;
    const uy = (py - img.offsetTop - base.ty) / base.s;
    s = clamp(ns, 1, 5);
    tx = qx - img.offsetLeft - ux * s;
    ty = qy - img.offsetTop - uy * s;
  }

  function clampPan() {
    if (s < 1.02) s = 1;
    const w = img.offsetWidth * s, h = img.offsetHeight * s;
    const vw = box.clientWidth, vh = box.clientHeight;
    const bx = img.offsetLeft, by = img.offsetTop;
    tx = w <= vw ? (vw - w) / 2 - bx : clamp(tx, vw - bx - w, -bx);
    ty = h <= vh ? (vh - h) / 2 - by : clamp(ty, vh - by - h, -by);
  }

  function open(src, alt, text) {
    img.src = src;
    img.alt = alt;
    caption.textContent = text;
    caption.hidden = !text;
    s = 1; tx = 0; ty = 0;
    apply();
    box.hidden = false;
    body.classList.add("no-scroll");
    rewind = closeOnBack(close);
  }

  function close(back = true) {
    if (box.hidden) return;
    box.hidden = true;
    body.classList.remove("no-scroll");
    box.style.removeProperty("--fade");
    pointers.clear();
    rewind?.(back);
    rewind = null;
  }

  function begin() {
    const pts = [...pointers.values()];
    start = { s, tx, ty, pts: pts.map((p) => ({ ...p })) };
    if (pts.length >= 2) {
      start.d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      start.m = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }
  }

  box.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".lb-close")) return;
    try { box.setPointerCapture(e.pointerId); } catch {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      moved = false;
      downOnImage = e.target === img;
    }
    begin();
  });

  box.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const m = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      zoomFrom(start, start.s * (d / start.d), start.m.x, start.m.y, m.x, m.y);
      moved = true;
    } else {
      const dx = pts[0].x - start.pts[0].x;
      const dy = pts[0].y - start.pts[0].y;
      if (Math.hypot(dx, dy) > 6) moved = true;
      if (!moved) return;
      if (s > 1) {
        tx = start.tx + dx;
        ty = start.ty + dy;
      } else { // смахивание вниз/вверх закрывает
        ty = start.ty + dy;
        box.style.setProperty("--fade", String(1 - Math.min(Math.abs(dy) / 400, 0.6)));
      }
    }
    apply();
  });

  function end(e) {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size) { begin(); return; }
    box.style.removeProperty("--fade");
    if (s === 1 && Math.abs(ty) > 100) { close(); return; }
    if (!moved) {
      const now = Date.now();
      if (now - lastTap < 300) {
        zoomFrom({ s, tx, ty }, s > 1 ? 1 : 2.5, e.clientX, e.clientY);
        lastTap = 0;
      } else {
        lastTap = now;
        if (!downOnImage) close();
      }
    }
    clampPan();
    apply(true);
  }
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);

  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomFrom({ s, tx, ty }, s * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    clampPan();
    apply();
  }, { passive: false });

  document.addEventListener("keydown", (e) => e.key === "Escape" && close());

  document.querySelector("main").addEventListener("click", (e) => {
    const target = e.target.closest("figure img");
    if (!target) return;
    open(target.currentSrc || target.src, target.alt, target.closest("figure").querySelector("figcaption")?.textContent || "");
  });
}

// ---------- офлайн: заранее положить в кэш всё, что нужно лекции ----------

function prefetchForOffline() {
  if (!("caches" in window) || !navigator.serviceWorker || navigator.connection?.saveData) return;
  navigator.serviceWorker.ready.then(() => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 2000));
    idle(async () => {
      const cache = await caches.open("runtime"); // имя совпадает с RUNTIME в sw.js
      const urls = new Set([
        location.href.split("#")[0],
        ...[...document.querySelectorAll("main img")].map((i) => i.src),
        ...performance.getEntriesByType("resource").map((r) => r.name),
      ]);
      for (const url of urls) {
        if (!url.startsWith("http") || url.endsWith(".pdf") || (await caches.match(url))) continue;
        await cache.add(url).catch(() => {});
      }
    });
  });
}
