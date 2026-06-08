const CACHE = 'lbh-v2';

// Install immediately — don't wait for existing tabs to close
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    // Delete old caches
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      // Take control of all open tabs right away
      .then(() => clients.claim())
      // Force every open tab to reload so they get fresh HTML
      .then(() => clients.matchAll({ type: 'window' }))
      .then(all => Promise.all(all.map(c => c.navigate(c.url))))
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
