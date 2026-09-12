// 006 — Service worker de la PWA: shell offline + notificaciones push.
// Mínimo y sin dependencias: network-first para navegaciones (no cachea API ni
// datos) y manejo de `push`/`notificationclick` para el deep link al handoff.

const CACHE = "vocero-shell-v1";
const SHELL = ["/", "/inbox"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Solo navegaciones de documento (nunca API ni assets de datos).
  if (request.mode !== "navigate") return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match("/"))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* payload no JSON: se ignora */
  }
  const title = payload.title || "Vocero";
  const options = {
    body: payload.body || "",
    data: payload.data || {},
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) || "/inbox";
  event.waitUntil(self.clients.openWindow(url));
});
