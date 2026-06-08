const CACHE = 'lbh-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  // Delete old caches and take control — no force-reload (avoids interrupting splash)
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Navigation (HTML pages): always fetch fresh from network, fall back to cache if offline
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Assets: serve from cache instantly, refresh in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
      return cached || fresh;
    })
  );
});
