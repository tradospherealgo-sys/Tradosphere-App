// Minimal PWA service worker: no offline caching of dynamic/authenticated
// content (this app is server-rendered against live session state and
// RLS-scoped data, so caching pages would risk serving stale or
// cross-account content). Its only job is to satisfy the installability
// requirement on browsers that still check for a fetch handler.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally a no-op passthrough — let the network handle every request.
});
