// ==============================================
// sw.js - Service Worker لتطبيق "ريم"
// يوفر تخزيناً مؤقتاً (Cache) لملفات الواجهة الثابتة
// لتحميل أسرع وعمل جزئي دون اتصال بالإنترنت.
// ملاحظة: نقطة /api/chat تبقى تتطلب اتصالاً بالإنترنت دائماً
// لأنها تعتمد على استجابة حيّة من الخادم.
// ==============================================

const CACHE_NAME = 'reem-cache-v4-gemini-ui';

// الملفات الثابتة التي يتم تخزينها مسبقاً عند التثبيت
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
];

// ---------- عند التثبيت: تخزين الملفات الثابتة ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ---------- عند التفعيل: حذف أي نسخ كاش قديمة ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ---------- استراتيجية الجلب (Fetch Strategy) ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // لا نتدخل أبداً في طلبات API — يجب أن تصل دائماً للسيرفر مباشرة
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // لا نتدخل في الطلبات الخارجية (مكتبات CDN، صور Pollinations المولّدة، الخطوط)
  // ونتركها تُجلب مباشرة من الشبكة دون تخزين مؤقت
  if (url.origin !== self.location.origin) {
    return;
  }

  // للملفات الثابتة: Cache First مع تحديث في الخلفية (Stale-While-Revalidate)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse); // في حال انقطاع الشبكة، نعتمد على الكاش

      return cachedResponse || networkFetch;
    })
  );
});
