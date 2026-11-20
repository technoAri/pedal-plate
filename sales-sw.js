/* Pedal Plate sales counter: lets /sales open without signal.
   Registered only by sales.html, with scope /sales, so it never touches the homepage or other pages.
   The page: network first (always the newest version with signal), the saved copy without signal.
   Fonts, logo and the QR reader: saved copy first. The Google Sheet API is never cached. */
const CACHE = 'pp-sales-v1';
const FILES = ['/sales', '/fonts/poppins-400.woff2', '/fonts/poppins-600.woff2', '/fonts/poppins-700.woff2', '/fonts/poppins-800.woff2',
  '/fonts/poppins-600-ext.woff2', '/fonts/poppins-800-ext.woff2', '/images/logo-96.webp', '/vendor/jsQR.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(u => c.add(new Request(u, {cache: 'reload'})).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pp-sales-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // the Sheet API and other sites: untouched
  const page = req.mode === 'navigate' && (url.pathname === '/sales' || url.pathname === '/sales.html');
  if (page) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/sales', copy)); } return r; })
      .catch(() => caches.match('/sales')));
    return;
  }
  if (FILES.indexOf(url.pathname) > 0) {
    e.respondWith(caches.match(url.pathname).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copy)); } return r; })));
  }
});
