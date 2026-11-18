"use client";
import { useEffect, useState } from "react";

type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "allspark-install-dismissed";
const VISITS_KEY = "allspark-visits";
const SESSION_KEY = "allspark-visit-counted";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

function safeGet(store: () => Storage, k: string): string | null {
  try {
    return store().getItem(k);
  } catch {
    return null;
  }
}
function safeSet(store: () => Storage, k: string, v: string) {
  try {
    store().setItem(k, v);
  } catch {
    /* depolama kapalı: sessizce geç */
  }
}
const local = () => window.localStorage;
const session = () => window.sessionStorage;

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const other = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && !other;
}

export function InstallPrompt() {
  const [mode, setMode] = useState<"none" | "native" | "ios">("none");
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);

  useEffect(() => {
    if (isStandalone()) return;

    const until = Number(safeGet(local, DISMISS_KEY) ?? 0);
    if (until > Date.now()) return;

    // Oturum başına bir kez say; ilk ziyarette gösterme.
    if (!safeGet(session, SESSION_KEY)) {
      safeSet(session, SESSION_KEY, "1");
      safeSet(local, VISITS_KEY, String(Number(safeGet(local, VISITS_KEY) ?? 0) + 1));
    }
    if (Number(safeGet(local, VISITS_KEY) ?? 0) < 2) return;

    if (isIosSafari()) {
      queueMicrotask(() => setMode("ios"));
      return;
    }
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as DeferredPrompt);
      setMode("native");
    };
    const onInstalled = () => setMode("none");
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function later() {
    safeSet(local, DISMISS_KEY, String(Date.now() + SNOOZE_MS));
    setMode("none");
    setDeferred(null);
  }

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* kullanıcı vazgeçti */
    }
    setDeferred(null);
    setMode("none");
  }

  if (mode === "none") return null;

  return (
    <>
      <style>{`
        .pwa-install{position:fixed;left:12px;right:12px;bottom:calc(var(--bottom-nav-h, 0px) + env(safe-area-inset-bottom) + 12px);z-index:60;
          max-width:480px;margin-inline:auto;display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;padding:12px 14px;
          background:var(--panel);color:var(--tx);border:1px solid var(--edge);
          clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px));
          animation:pwa-in .25s ease-out}
        .pwa-install p{margin:0;flex:1 1 200px;font-size:14px;line-height:1.35}
        .pwa-install .pwa-actions{display:flex;gap:8px;flex:0 0 auto}
        .pwa-install button{min-height:44px;min-width:44px;padding:0 14px;font:inherit;font-weight:600;cursor:pointer}
        .pwa-install .pwa-yes{background:var(--ac);color:var(--rec-tx, #fff);border:0}
        .pwa-install .pwa-no{background:transparent;color:var(--tx);border:1px solid var(--btn-line)}
        .pwa-install button:focus-visible{outline:2px solid var(--ac-tx);outline-offset:2px}
        @keyframes pwa-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){.pwa-install{animation:none}}
      `}</style>
      <div className="pwa-install" role="region" aria-label="Uygulamayı ana ekrana ekle">
        {mode === "native" ? (
          <>
            <p>AllSpark&apos;ı ana ekrana ekle</p>
            <div className="pwa-actions">
              <button type="button" className="pwa-yes" onClick={install}>
                Ekle
              </button>
              <button type="button" className="pwa-no" onClick={later}>
                Şimdi değil
              </button>
            </div>
          </>
        ) : (
          <>
            <p>AllSpark&apos;ı ana ekrana ekle: Safari&apos;de Paylaş düğmesine, ardından &quot;Ana Ekrana Ekle&quot;ye dokun.</p>
            <div className="pwa-actions">
              <button type="button" className="pwa-no" onClick={later}>
                Şimdi değil
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
