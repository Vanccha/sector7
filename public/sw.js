/* SECTOR7 service worker — yalnız push bildirimi. Önbellekleme yok. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
