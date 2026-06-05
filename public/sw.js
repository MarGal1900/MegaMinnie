const CACHE_NAME = "megaminnie-cache-v18";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/styles.css",
  "/js/app.js",
  "/js/api.js",
  "/js/dom.js",
  "/js/interview-commands.js",
  "/js/tasks-events.js",
  "/js/nl-time-picker.js",
  "/js/conversation-recording.js",
  "/js/realtime-interview.js",
  "/js/openai-speech.js",
  "/js/share-report-email.js",
  "/js/gespreksverslag-docx.bundle.js",
  "/images/megaminnie-profile.png",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
  self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) =>
      clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" })),
    );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === "navigate") {
          const fallback = await caches.match("/index.html");
          if (fallback) return fallback;
        }

        return caches.match("/");
      }),
  );
});
