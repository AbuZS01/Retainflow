const CACHE = 'retainflow-v48';
const AUDIO_CACHE = 'retainflow-audio-v1';
const AUDIO_MAX = 200; // cap cached ayah recitations (~LRU)
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
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== AUDIO_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Keep the audio cache under AUDIO_MAX entries (evict oldest-inserted first).
async function trimAudioCache() {
  const cache = await caches.open(AUDIO_CACHE);
  const keys = await cache.keys();
  if (keys.length <= AUDIO_MAX) return;
  for (const req of keys.slice(0, keys.length - AUDIO_MAX)) {
    await cache.delete(req);
  }
}

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // API: network-only, graceful 503 offline (review queue held client-side).
  if (url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Recitation audio: cache-first so revising on a commute works offline.
  if (url.includes('everyayah.com') && url.endsWith('.mp3')) {
    e.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        try {
          const res = await fetch(e.request);
          if (res.ok) { cache.put(e.request, res.clone()); trimAudioCache(); }
          return res;
        } catch {
          return new Response('', { status: 504 });
        }
      })
    );
    return;
  }

  // App shell: cache-first, fall back to network.
  e.respondWith(
    caches.match(e.request).then((cached) => cached ?? fetch(e.request))
  );
});
