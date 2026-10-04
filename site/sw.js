// Офлайн-доступ: страницы — сначала сеть, потом кэш; остальное (стили, картинки, шрифты, KaTeX) —
// из кэша с фоновым обновлением. PDF не кэшируются. __VERSION__ подставляет build.py.

const SHELL = "shell-__VERSION__";
const RUNTIME = "runtime"; // то же имя использует app.js, когда заранее кладёт картинки лекции

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(["./", "assets/style.css", "assets/app.js", "search.json", "manifest.webmanifest"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    if (req.mode !== "navigate") throw err;
    return new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

const OFFLINE_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Нет сети</title><body style="font:18px/1.6 sans-serif;max-width:30rem;margin:4rem auto;padding:0 16px;color:#444">
<h1 style="font-size:1.4rem">Нет сети</h1><p>Эта страница ещё не сохранена для офлайна: без интернета открываются
только лекции, которые вы уже открывали.</p><p><a href="./" onclick="history.back();return false">← Назад</a></p>`;

async function staleWhileRevalidate(e) {
  const cache = await caches.open(RUNTIME);
  const hit = (await cache.match(e.request)) || (await caches.match(e.request));
  const update = fetch(e.request).then((res) => {
    if (res.ok || res.type === "opaque") cache.put(e.request, res.clone());
    return res;
  });
  if (hit) {
    e.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || !url.protocol.startsWith("http") || url.pathname.endsWith(".pdf")) return;
  const fresh = req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html")
    || url.pathname.endsWith("search.json") || url.pathname.endsWith("app.js") || url.pathname.endsWith("style.css");
  e.respondWith(fresh ? networkFirst(req) : staleWhileRevalidate(e));
});
