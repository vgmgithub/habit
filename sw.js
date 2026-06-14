// sw.js — offline-first service worker.
// Strategy: precache the app shell; serve same-origin GETs cache-first with a
// network fallback that refreshes the cache. All habit DATA lives in IndexedDB
// (handled by the page), so the SW only needs to cache the static shell.

const CACHE = 'habits-v44';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/model.js',
  './js/quotes.js',
  './js/backup.js',
  './js/leaderboard.js',
  './icons/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/growth-1.png',
  './icons/growth-2.png',
  './icons/growth-3.png',
  './icons/growth-4.png',
  './icons/growth-5.png',
  './icons/growth-6.png',
];

self.addEventListener('install', (e) => {
  // Activate immediately so a fresh deploy reaches INSTALLED PWAs on the next
  // launch — no "update available" button to hunt for. Pairs with
  // clients.claim() below and the page's controllerchange→reload handler so the
  // app silently refreshes onto the new code. (Previously this stayed waiting,
  // which froze installed PWAs on stale JS — the cause of "works in the browser
  // / incognito but not in the PWA".)
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Notification handling — supports Done / Snooze actions where available.
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (e) => {
  const action = e.action;
  const data = (e.notification && e.notification.data) || {};

  // Snooze: reschedule the same notification ~30 min later (only where
  // Notification Triggers are supported — otherwise silently dismiss).
  if (action === 'snooze') {
    e.notification.close();
    e.waitUntil((async () => {
      try {
        if ('showTrigger' in Notification.prototype && typeof TimestampTrigger !== 'undefined') {
          await self.registration.showNotification(e.notification.title, {
            body: e.notification.body,
            icon: e.notification.icon,
            badge: e.notification.badge,
            tag: e.notification.tag + '-snooze',
            data,
            actions: e.notification.actions,
            requireInteraction: true,
            silent: false,
            vibrate: [180, 80, 180, 80, 220],
            showTrigger: new TimestampTrigger(Date.now() + 30 * 60 * 1000),
          });
        }
      } catch (_) {}
    })());
    return;
  }

  e.notification.close();

  // Determine target URL + warm-launch message based on notification tag + action.
  const tag = e.notification.tag || '';
  const isWrapup = tag === 'wrapup' || tag.startsWith('wrapup-') || (data && data.kind === 'wrapup');
  const url = action === 'done' && data.habitId
    ? `./?habit=${encodeURIComponent(data.habitId)}&action=done`
    : isWrapup
      ? './?action=wrapup'
      : './?view=today';

  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/habit')) {
        if (action === 'done' && data.habitId) c.postMessage({ type: 'mark-done', habitId: data.habitId });
        else if (isWrapup) c.postMessage({ type: 'open-wrapup' });
        if ('focus' in c) return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
