/**
 * sw.js — Kill Switch
 * Desregistra o Service Worker e limpa todos os caches para resolver o loop de reload.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .then(() => self.registration.unregister())
    );
    self.clients.claim();
});
