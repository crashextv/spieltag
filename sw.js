'use strict';
// Service Worker: speichert alle App-Dateien auf dem Handy,
// damit die App auch ohne Internet startet.
//
// Bei jeder neuen Version BUILD erhöhen – und in allen Dateien der Liste
// CHECKED die Markierung "build-N" auf dieselbe Zahl setzen.
const BUILD = 11;
const CACHE = 'spieltag-v' + BUILD;
const MARK = 'build-' + BUILD;

// Diese Dateien müssen die Markierung enthalten. So merken wir, wenn der
// Server noch alte Dateien liefert (GitHub braucht manchmal ein paar Minuten).
const CHECKED = ['./index.html', './app.css', './db.js', './app.js', './kader.js', './pitch.js', './spiel.js', './live.js', './bericht.js'];
const OTHER = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of CHECKED) {
      // cache: 'reload' = am Zwischenspeicher des Browsers vorbei, frisch vom Server
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) throw new Error(url + ' fehlt');
      const text = await res.text();
      if (!text.includes(MARK)) {
        // Alte Datei erwischt -> Installation abbrechen, der Browser versucht es später erneut
        await caches.delete(CACHE);
        throw new Error(url + ' ist noch nicht ' + MARK);
      }
      const init = { headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/plain' } };
      await cache.put(url, new Response(text, init));
      if (url === './index.html') await cache.put('./', new Response(text, init));
    }
    await cache.addAll(OTHER.map(u => new Request(u, { cache: 'reload' })));
  })());
  // Beim allerersten Installieren sofort aktiv werden
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Zuerst aus dem Speicher auf dem Handy laden (schnell, offline)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE)
      .then(c => c.match(event.request, { ignoreSearch: true }))
      .then(hit => hit || fetch(event.request))
      .catch(() => caches.open(CACHE).then(c => c.match('./index.html')))
  );
});
