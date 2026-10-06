// Service Worker for PWA installation support
const CACHE_NAME = 'video-editor-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Network first strategy
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
