/* سرویس‌ورکر آوا: اجرای آفلاین */
const CACHE = 'ava-v1';
const CORE = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon.svg',
  './vendor/jsmediatags.min.js', './js/db.js', './js/artists.js', './js/country.js',
  './js/scanner.js', './js/player.js', './js/app.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'musicbrainz.org') return;
  const sameOrigin = url.origin === location.origin;
  const cacheable = sameOrigin || /fonts\.(googleapis|gstatic)\.com|flagcdn\.com/.test(url.hostname);
  if (!cacheable) return;
  // شبکه اول برای فایل‌های خود اپ (تا به‌روزرسانی‌ها سریع برسند)، کش اول برای فونت و پرچم
  if (sameOrigin) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
    })));
  }
});
