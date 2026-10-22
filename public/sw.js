// The service worker. server.js puts VERSION and PRECACHE (every file the game needs) at the top
// when it sends this out.
//
// It keeps a copy of the whole game, so the page opens with no connection at all (installed as an
// app or just bookmarked) and main.js plays it offline against bots. Online it always asks the
// server first, so the game never runs out of step with it, and refreshes the copy as it goes.
const CACHE = `war-is-racket-${VERSION}`;
const WAIT = 6000;   // ms to wait for the server before falling back on the copy (a bad signal)

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

// a new version: drop the old copies, and look after the open pages straight away
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    // (spear-sphere: copies kept under the game's old name)
    .then(keys => Promise.all(keys.filter(k => /^(war-is-racket|spear-sphere)-/.test(k) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname === '/health' || url.pathname === '/sw.js') return;
  e.respondWith(fresh(req, url));
});

async function fresh(req, url) {
  const cache = await caches.open(CACHE);
  // the page itself, at any address (a rock's link, /KPTX, is the page too)
  const key = req.mode === 'navigate' ? '/index.html' : url.pathname;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), WAIT);
  try {
    const res = await fetch(req, { signal: stop.signal });
    if (res.status === 200) cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key)) || new Response('Ugg. No signal, and no copy of that here.', { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
