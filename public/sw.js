// Funciona offline: guarda a página e os assets; world.json e repo.json vêm da rede quando dá.
const CACHE = 'stargazzing-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './world.json', './icon.svg', './manifest.webmanifest']).catch(() => undefined))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const fresh = /\.(json|xml)$/.test(url.pathname) || req.mode === 'navigate';
  if (fresh) {
    // rede primeiro (dados mudam a cada star), cache se estiver offline
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); } return r; }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  } else {
    // assets têm hash no nome: cache primeiro
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(req, c)); } return res; })));
  }
});
