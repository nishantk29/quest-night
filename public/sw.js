// Quest Night service worker (same pattern as Mafia Night): versioned cache for static files,
// network-first for pages, and /api/* and /ws/* never cached. `npm run deploy` stamps VERSION.
const VERSION = 'quest-dev';
const PRECACHE = ['/', '/styles.css', '/theme.css', '/fx.css', '/manifest.webmanifest',
  ...['app', 'glyphs', 'rules', 'ui_icons', 'art', 'cards', 'faq', 'table_ui', 'fx'].map((m) => `/js/${m}.js`),
  ...['big-shoulders-display-var', 'alegreya-sans-400', 'alegreya-sans-500', 'alegreya-sans-700', 'alegreya-sans-800', 'alegreya-italic-var', 'cinzel-600', 'cinzel-800', 'cinzel-decorative-700'].map((f) => `/fonts/${f}.woff2`),
  '/icons/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
const isLive = (u) => u.pathname.startsWith('/api/') || u.pathname.startsWith('/ws/');
const storable = (r) => r && r.ok && r.status === 200 && !r.redirected && r.type === 'basic';

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  await Promise.allSettled(PRECACHE.map(async (p) => { const r = await fetch(p, { cache: 'reload' }); if (storable(r)) await c.put(p, r); }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('quest-') && k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isLive(url)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { if (url.pathname === '/' && storable(r)) { const c = r.clone(); caches.open(VERSION).then((x) => x.put('/', c)); } return r; })
      .catch(async () => (await caches.match('/')) || Response.error()));
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(url.pathname);
    if (hit) return hit;
    const r = await fetch(req);
    if (storable(r)) { const c = r.clone(); caches.open(VERSION).then((x) => x.put(url.pathname, c)); }
    return r;
  })());
});
