"use client";
import { useEffect, useState, useTransition } from "react";
import { registerSw } from "@/components/pwa/registerSw";
import { removePushSubscriptionAction, savePushSubscriptionAction } from "@/app/(app)/bildirimler/actions";

function toKey(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "checking" | "unsupported" | "denied" | "off" | "on";

export function PushToggle({
  available,
  publicKey,
  deviceCount,
}: {
  available: boolean;
  publicKey: string | null;
  deviceCount: number;
}) {
  const [status, setStatus] = useState<Status>("checking");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (alive) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (alive) setStatus("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        if (alive) setStatus(sub ? "on" : "off");
      } catch {
        if (alive) setStatus("off");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!available) {
    return (
      <p className="notice" style={{ margin: 0 }}>
        Bu sunucuda push bildirimi ayarlanmamış. Uygulama içi bildirimler yine de çalışır.
      </p>
    );
  }

  function enable() {
    start(async () => {
      setMsg(null);
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setStatus(perm === "denied" ? "denied" : "off");
          setMsg({ ok: false, text: "İzin verilmedi, push açılmadı." });
          return;
        }
        const reg = await registerSw();
        if (!reg) throw new Error("sw");
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey ?? "") }));
        const r = await savePushSubscriptionAction(sub.toJSON());
        if (!r.ok) {
          setMsg({ ok: false, text: r.error });
          return;
        }
        setStatus("on");
        setMsg({ ok: true, text: "Bu cihazda push bildirimleri açıldı." });
      } catch {
        setMsg({ ok: false, text: "Bu cihazda push açılamadı. Biraz sonra tekrar dene." });
      }
    });
  }

  function disable() {
    start(async () => {
      setMsg(null);
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await removePushSubscriptionAction({ endpoint });
        }
        setStatus("off");
        setMsg({ ok: true, text: "Bu cihazda push bildirimleri kapatıldı." });
      } catch {
        setMsg({ ok: false, text: "Push kapatılamadı. Biraz sonra tekrar dene." });
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {status === "unsupported" && (
        <p className="notice" style={{ margin: 0 }}>
          Bu tarayıcı push bildirimini desteklemiyor.
        </p>
      )}
      {status === "denied" && (
        <p className="notice" style={{ margin: 0 }}>
          Tarayıcıda bu site için bildirimler engellenmiş. Adres çubuğundaki site ayarlarından bildirim iznini
          &quot;İzin ver&quot; yapıp sayfayı yenile.
        </p>
      )}
      {(status === "off" || status === "on" || status === "checking") && (
        <div>
          {status === "on" ? (
            <button type="button" className="btn-line" onClick={disable} disabled={pending}>
              Bu cihazda push bildirimlerini kapat
            </button>
          ) : (
            <button type="button" className="btn-solid" onClick={enable} disabled={pending || status === "checking"}>
              Bu cihazda push bildirimlerini aç
            </button>
          )}
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Kayıtlı cihaz sayısı: {deviceCount}
      </p>
      <div aria-live="polite" role="status">
        {msg && <span className={msg.ok ? "" : "field-error"}>{msg.text}</span>}
      </div>
    </div>
  );
}
