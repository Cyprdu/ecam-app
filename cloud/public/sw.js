// Cache de l'app (fonctionne hors ligne) + notifications push.
const CACHE = 'ecam-v31';
const SHELL = ['/', '/app.css', '/app.js', '/manifest.webmanifest', '/icon-180.png', 'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // Réseau d'abord, cache en secours
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : { title: 'ECAM' };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: '/icon-180.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    // mémorisé aussi pour l'app qui démarre (iOS peut ignorer l'adresse passée à openWindow)
    await (await caches.open('nav')).put('/__nav', new Response(JSON.stringify({ url, at: Date.now() })));
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) { wins[0].postMessage({ type: 'open', url }); return wins[0].focus(); }
    return self.clients.openWindow(url);
  })());
});
