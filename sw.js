/* Dasturxon service worker: menus stay readable on weak or missing mobile internet.
   Pages: network first, cached copy when offline. Public menu data (anonymous reads only): network first with a short timeout.
   Photos and vendor files: cache first (their file names never change). Anything signed-in or written is never cached. */
const VERSION = 'dx-v3';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const IMG = 'dx-img';
const SUPABASE = 'https://suxazpqeadyvvuiikdyz.supabase.co';
const ANON = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1eGF6cHFlYWR5dnZ1aWlrZHl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MjU4NTMsImV4cCI6MjEwNzQwMTg1M30.K4Ag_HJ3cd8MqVe40CUMjHeQg1PG1hC2vgshkOF5X_Q';
const SHELL_FILES = ['./', './index.html', './vendor/supabase-js-2.45.4.js', './manifest.webmanifest', './icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dx-') && k !== SHELL && k !== DATA && k !== IMG).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

async function networkFirst(req, cacheName, key, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(req), ms);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    cache.put(req, res.clone());
    if (limit) cache.keys().then((keys) => { if (keys.length > limit) keys.slice(0, keys.length - limit).forEach((k) => cache.delete(k)); });
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
      e.respondWith(networkFirst(req, SHELL, './index.html', 8000).catch(() => caches.match('./index.html')));
      return;
    }
    if (url.pathname.includes('/vendor/') || /\/icon-\d+\.png$/.test(url.pathname)) {
      e.respondWith(cacheFirst(req, SHELL));
    }
    return;
  }

  if (url.origin === SUPABASE) {
    if (url.pathname.startsWith('/storage/v1/object/public/')) {
      e.respondWith(cacheFirst(req, IMG, 400));
      return;
    }
    if (url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/rest/v1/rpc/')) {
      const auth = req.headers.get('authorization');
      if (auth && auth !== ANON) return; /* signed-in owners always read live data */
      const key = `${url.href}${url.search ? '&' : '?'}__accept=${encodeURIComponent(req.headers.get('accept') || '')}`;
      e.respondWith(networkFirst(req, DATA, key, 7000));
    }
    return;
  }

  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, SHELL));
  }
});
