/* Service worker: offline cache + auto-update (stale-while-revalidate).
 * Bump CACHE when you want clients to drop old cached files on next launch.
 * Only registered over http/https (see index.html) — never on file://.
 */
const CACHE = "ivrit-v1";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./sentences.js", "./grammar.js",
  "./data/vocab.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // let cross-origin (e.g. Ollama) hit the network directly
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;   // instant from cache; refresh in background for next launch
    })
  );
});
