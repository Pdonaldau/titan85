const CACHE_NAME = "titan85-v11";
// exercise GIFs/thumbnails stream from these hosts and are cached after first view
const MEDIA_CACHE = "titan85-media-v1";
const MEDIA_HOSTS = ["cdn.jsdelivr.net", "raw.githubusercontent.com"];

const FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/storage.js",
  "./js/charts.js",
  "./js/physique3d.js",
  "./js/vendor/three.module.min.js",
  "./js/exercises.js",
  "./js/app.js",
  "./data/body.bin",
  "./data/meals.json",
  "./data/recipes.json",
  "./data/workouts.json",
  "./data/shopping.json",
  "./data/exercises.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== MEDIA_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  // exercise media: cache-first so animations work offline once seen
  const url = new URL(event.request.url);
  if (MEDIA_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(cache =>
        cache.match(event.request).then(cached =>
          cached || fetch(event.request).then(response => {
            if (response && (response.ok || response.type === "opaque")) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
        )
      )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
