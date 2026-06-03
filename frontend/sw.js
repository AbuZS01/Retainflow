const CACHE = 'retainflow-v21';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached ?? fetch(e.request))
  );
});
