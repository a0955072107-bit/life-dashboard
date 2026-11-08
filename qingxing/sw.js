// 清醒行動派後台：讓 Chrome 可以安裝成應用程式。資料一律先抓最新的，沒網路時才用上次的。
const CACHE = 'qx-admin-v2'
self.addEventListener('install', (e) => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res })
      .catch(() => caches.match(e.request))
  )
})
