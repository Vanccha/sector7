let pending: Promise<ServiceWorkerRegistration | null> | null = null;

/** Idempotent SW kaydı; desteklenmiyorsa ya da hata olursa null döner. */
export function registerSw(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  pending ??= navigator.serviceWorker.register("/sw.js").catch(() => {
    pending = null;
    return null;
  });
  return pending;
}
