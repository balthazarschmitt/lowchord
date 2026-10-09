// Offline cache. Bump VERSION whenever files change so phones pick up the update.
const VERSION = 'lowchord-0.2.1';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/main.js', 'src/theory.js', 'src/engine.js', 'src/clock.js', 'src/midi.js', 'src/out.js',
  'src/looper.js', 'src/modes.js', 'src/drums.js', 'src/presets.js', 'src/input.js', 'src/store.js',
  'src/ui/display.js', 'src/ui/menus.js', 'src/worklet/synth.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive when online), cache fallback when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
