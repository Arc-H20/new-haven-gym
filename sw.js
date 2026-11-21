// Offline support. App files come from the network when it answers within a few seconds,
// otherwise from the cache, so a new version shows up on the next online open.
// GitHub API calls always go to the network (the app keeps its own data cache).
const VERSION = "nhg-1.0.2";
const SHELL = ["./", "index.html", "styles.css", "lib.js", "store.js", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "fonts/inter.woff2", "fonts/barlow-600.woff2", "fonts/barlow-700.woff2"];
const WAIT_MS = 3000;

self.addEventListener("install", e => {
  // cache: "reload" skips the browser's HTTP cache, which GitHub Pages keeps for 10 minutes.
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: "reload" })).then(r => r.ok && c.put(u, r)))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const net = fetch(e.request, { cache: "no-cache" }).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
    const timeout = new Promise(r => setTimeout(() => r(null), WAIT_MS));
    const first = await Promise.race([net, timeout]);
    if (first) return first;
    const hit = await cache.match(e.request, { ignoreSearch: true }) || (e.request.mode === "navigate" && await cache.match("index.html"));
    return hit || (await net) || Response.error();
  }));
});
