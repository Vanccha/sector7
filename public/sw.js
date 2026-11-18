/* AllSpark service worker: push bildirimi + çevrimdışı sayfa.
   Oturumlu HTML ve API yanıtları ASLA önbelleğe alınmaz (kişisel veri). */
const CACHE = "allspark-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Gezinme: ağdan; ağ hatasında çevrimdışı sayfa. HTML önbelleğe yazılmaz.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
    return;
  }

  // Değişmez derleme çıktıları: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
  // /api/ ve diğer her şey: dokunulmadan ağa.
});

self.addEventListener("push", (event) => {
  let p = { title: "SECTOR7", body: "", link: null, tag: "sector7" };
  try {
    if (event.data) p = { ...p, ...event.data.json() };
  } catch (e) {
    /* geçersiz yük: varsayılanı göster */
  }
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      data: { link: p.link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of wins) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) {
            try {
              await c.navigate(link);
            } catch (e) {
              /* aynı kökene değilse sessizce geç */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(link);
    })(),
  );
});
