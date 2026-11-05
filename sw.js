// 網路優先：每次都抓最新檔案（避開 GitHub Pages 的瀏覽器快取），離線時才用快取
const CACHE = "lifedash-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request, { cache: "no-store" });
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch {
      return (await caches.match(e.request)) || Response.error();
    }
  })());
});
