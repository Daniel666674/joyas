// Admin-only service worker — caches only static brand images.
// Never caches admin.html, admin.js, or any JSON manifest so the admin
// always sees fresh data. Cache is versioned; old caches are evicted on
// activate so a header/logo change takes effect on the next admin load.
"use strict";

var CACHE_NAME = "hje-admin-v1";
var BRAND_ASSETS = [
  "/joyas/brand/logo-mark.png",
  "/joyas/brand/favicon-32.png",
  "/joyas/brand/favicon-16.png",
  "/joyas/brand/favicon-180.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(BRAND_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  var url = e.request.url;
  // Never intercept: admin.html, JS manifests (*.json, products-data.js),
  // or navigation requests — these must always be fresh.
  if (
    url.indexOf("admin.html") !== -1 ||
    url.indexOf("admin.js") !== -1 ||
    url.indexOf(".json") !== -1 ||
    url.indexOf("products-data.js") !== -1 ||
    e.request.mode === "navigate"
  ) {
    return;
  }
  // Brand images: cache-first
  if (BRAND_ASSETS.some(function (p) { return url.indexOf(p) !== -1; })) {
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        return cached || fetch(e.request).then(function (res) {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(e.request, clone); });
          return res;
        });
      })
    );
  }
});
