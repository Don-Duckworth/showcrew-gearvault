// ShowCrew GearVault service worker — offline app shell. Bump VERSION whenever files change.
// Supabase (auth / database / storage) is NEVER cached: those requests are cross-origin and pass straight through,
// and same-origin /auth|rest|storage|realtime/v1 paths are explicitly bypassed too.
const VERSION = 'scgv-v2.1.0';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/store.js', './js/files.js', './js/carnet.js', './js/cloud.js', './js/cloudmap.js', './js/cache.js', './js/auth.js', './js/config.js',
  './js/vendor/supabase.js', './js/emx.js', './js/scan.js', './js/vendor/zxing.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
];
const NETWORK_FIRST = /\/js\/config\.js$/; // so filling in config.js takes effect on the next load
const NEVER = /\/(auth|rest|storage|realtime|functions)\/v1\//;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('scgv-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || NEVER.test(url.pathname) || /supabase\.(co|in)$/.test(url.hostname)) return;
  if (NETWORK_FIRST.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try { const res = await fetch(req, { cache: 'no-store' }); if (res.ok) cache.put(req, res.clone()); return res; }
      catch { return (await cache.match(req, { ignoreSearch: true })) || new Response('Offline', { status: 503 }); }
    })());
    return;
  }
  // Stale-while-revalidate for the app shell; navigations fall back to cached index.html offline.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    const net = fetch(req).then(res => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(net); return cached; }
    return (await net) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
