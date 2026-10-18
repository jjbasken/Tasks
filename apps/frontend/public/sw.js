// Replaced by the production build with a content fingerprint and every asset.
const CACHE = 'tasks-shell-__BUILD_ID__'
const PRECACHE = /* __PRECACHE__ */ ['/index.html', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', event => {
  // Installation is atomic: a failed download leaves the previous worker active.
  // An update waits until existing windows close or the user accepts it, so an
  // open editor keeps the matching HTML, scripts and styles for its version.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    PRECACHE.map(url => new Request(url, { cache: 'reload' }))
  )))
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => (key.startsWith('tasks-shell-') || key === 'tasks-v1') && key !== CACHE).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return
  // All SPA routes, including links never opened before, share the cached shell.
  // Only build-listed files are served from this cache; API data is handled by
  // the app's encrypted account cache, never by the worker.
  const path = event.request.mode === 'navigate' ? '/index.html' : url.pathname
  if (!PRECACHE.includes(path)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    return await cache.match(path) || fetch(event.request)
  })())
})
