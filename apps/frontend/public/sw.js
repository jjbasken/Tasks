const CACHE = 'tasks-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  // Skip non-GET and API requests — always go to network
  if (e.request.method !== 'GET') return
  if (new URL(e.request.url).pathname.startsWith('/api/')) return

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone())
          return res
        })
        // Serve cached immediately, refresh in background
        return cached || network
      })
    )
  )
})
