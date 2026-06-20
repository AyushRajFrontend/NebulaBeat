/* ══════════════════════════════════════════
   NEBULABEAT — SERVICE WORKER (PWA)
   Cache-first for shell, network-first for fonts
   ══════════════════════════════════════════ */
const CACHE  = 'nebulabeat-v1';
const SHELL  = [
  '/',
  '/index.html',
  '/style.css',
  '/particles.js',
  '/audio.js',
  '/ui.js',
  '/genre-ai.js',
  '/recorder.js',
  '/cosmic-sync.js',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first for Google Fonts (always fresh)
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});