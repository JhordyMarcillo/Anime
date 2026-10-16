'use strict';
// Solo guarda la "cáscara" de la app para que sea instalable; el video y la API siempre van a la red.
const CACHE = 'shell-v1';
const SHELL = ['./', 'style.css', 'app.js', 'icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !SHELL.some((p) => url.pathname.endsWith(p === './' ? '/' : p))) return;
  e.respondWith(fetch(e.request).then((r) => { caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
});
