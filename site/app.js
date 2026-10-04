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
const reviewSwitch = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": "false" });

const settings = el("div", { class: "panel settings", id: "settings", role: "dialog", "aria-label": "Настройки чтения" },
  el("div", { class: "set-row" }, el("span", { text: "Размер текста" }),
    el("div", { class: "seg" }, fontMinus, fontLevel, fontPlus)),
  el("div", { class: "set-row" }, el("span", { text: "Тема" }), el("div", { class: "seg" }, ...themeButtons)),
);
if (isLecture) {
  settings.append(el("label", { class: "set-row" }, el("span", { text: "Быстро повторить" }), reviewSwitch));
}
body.append(settings);
addPanel(settings, settingsButton);

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
    searchResults.innerHTML = '<p class="search-hint">Ищет по тексту всех лекций. Например: <i>NDCG</i>, <i>retention</i>, <i>A/B-тест</i>.</p>';
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
  // на главной и на странице курса — отметки о прочитанном
  document.querySelectorAll(".lectures a").forEach((a) => {
    const saved = store.json(posKey(pagePath(a.href)));
    const max = saved?.max || 0;
    if (max < 0.02) return;
    const done = max >= 0.97;
    a.style.setProperty("--read", done ? 1 : max.toFixed(3));
    a.classList.add(done ? "read-done" : "read-some");
    a.querySelector(".num").append(el("span", { class: "read", text: done ? "прочитано" : `прочитано ${Math.round(max * 100)}%` }));
  });
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
  let reviewShare = 1; // доля текста, видимая в режиме «Быстро повторить»
  remaining.addEventListener("click", () => {
    remainingOff = !remainingOff;
    store.set("remaining", remainingOff ? "off" : null);
    updateProgress();
  });

  function progress() {
    const end = main.getBoundingClientRect().bottom + scrollY - innerHeight;
    return end > 0 ? clamp(scrollY / end, 0, 1) : 1;
  }

  function updateProgress() {
    const p = progress();
    progressBar.firstChild.style.transform = `scaleX(${p})`;
    ring.style.setProperty("--p", p);
    const left = minutes * reviewShare * (1 - p);
    const label = p > 0.985 ? "дочитано" : `~${Math.max(1, Math.ceil(left))} мин`;
    remainingText.textContent = label;
    remaining.classList.toggle("off", remainingOff);
    remaining.setAttribute("aria-label", remainingOff
      ? "Показать, сколько осталось читать"
      : `Осталось ${label}. Нажмите, чтобы скрыть`);
    toTop.classList.toggle("show", !barHidden && scrollY > innerHeight * 1.5);
  }
  onScroll.push(updateProgress);
  addEventListener("resize", updateProgress);
  updateProgress();

  // ----- место чтения -----
  const readingLine = () => innerHeight * 0.25;
  const saved = store.json(key);
  let maxRead = saved?.max || 0;
  let moved = false;
  const startY = scrollY;

  function savePosition() {
    if (!moved) return;
    const p = progress();
    maxRead = Math.max(maxRead, p);
    const sec = sectionAt(allSections, readingLine());
    store.set(key, JSON.stringify({
      id: sec ? sec.id : "",
      off: Math.round(sec ? readingLine() - sec.getBoundingClientRect().top : scrollY),
      p: Number(p.toFixed(3)),
      max: Number(maxRead.toFixed(3)),
    }));
  }
  let saveTimer;
  onScroll.push(() => {
    if (Math.abs(scrollY - startY) > 100) moved = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 400);
  });
  addEventListener("pagehide", savePosition);
  document.addEventListener("visibilitychange", () => document.hidden && savePosition());

  const savedSection = saved?.id ? document.getElementById(saved.id) : null;
  if (!location.hash && saved && saved.p > 0.03 && saved.p < 0.97 && scrollY < 100 && (savedSection || !saved.id)) {
    const where = savedSection ? `с раздела «${sectionTitle(savedSection)}»` : "с места, где остановились";
    const resume = el("div", { class: "resume", role: "status" },
      el("span", { class: "resume-text", text: `Продолжить ${where}?` }),
      el("button", {
        type: "button", class: "resume-go", text: "Продолжить",
        onclick: () => {
          hideResume();
          const top = savedSection
            ? savedSection.getBoundingClientRect().top + scrollY + saved.off - readingLine()
            : saved.off;
          scrollTo({ top, behavior: "auto" });
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
    reviewShare = on ? main.innerText.length / main.textContent.length : 1;
    if (anchor) {
      const target = visible(anchor) ? anchor : sections.slice(sections.indexOf(anchor)).find(visible);
      target?.scrollIntoView();
    }
    updateActive();
    updateProgress();
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
