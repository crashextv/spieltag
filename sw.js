'use strict';
// Service Worker: speichert alle App-Dateien auf dem Handy,
// damit die App auch ohne Internet startet.
// Bei jeder neuen Version die Nummer erhöhen!
const CACHE = 'spieltag-v3';

const FILES = [
  './',
  './index.html',
  './app.css',
  './db.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
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
    caches.match(event.request, { ignoreSearch: true })
      .then(hit => hit || fetch(event.request))
      .catch(() => caches.match('./index.html'))
  );
});
