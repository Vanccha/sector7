"use client";
import { useEffect, useState } from "react";
import styles from "./install.module.css";
import { useInstall } from "./install-store";

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

export function InstallPrompt() {
  const { state, install } = useInstall();
  const [eligible, setEligible] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (state === "installed") return;
    const until = Number(safeGet(local, DISMISS_KEY) ?? 0);
    if (until > Date.now()) return;

    // Oturum başına bir kez say; ilk ziyarette gösterme.
    if (!safeGet(session, SESSION_KEY)) {
      safeSet(session, SESSION_KEY, "1");
      safeSet(local, VISITS_KEY, String(Number(safeGet(local, VISITS_KEY) ?? 0) + 1));
    }
    if (Number(safeGet(local, VISITS_KEY) ?? 0) < 2) return;
    queueMicrotask(() => setEligible(true));
  }, [state]);

  function later() {
    safeSet(local, DISMISS_KEY, String(Date.now() + SNOOZE_MS));
    setHidden(true);
  }

  if (!eligible || hidden || (state !== "native" && state !== "ios")) return null;

  return (
    <div className={styles.prompt} role="region" aria-label="Uygulamayı ana ekrana ekle">
      {state === "native" ? (
        <>
          <p>AllSpark&apos;ı ana ekrana ekle</p>
          <div className={styles.actions}>
            <button type="button" className={styles.yes} onClick={() => void install()}>
              Ekle
            </button>
            <button type="button" className={styles.no} onClick={later}>
              Şimdi değil
            </button>
          </div>
        </>
      ) : (
        <>
          <p>AllSpark&apos;ı ana ekrana ekle: Safari&apos;de Paylaş düğmesine, ardından &quot;Ana Ekrana Ekle&quot;ye dokun.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.no} onClick={later}>
              Şimdi değil
            </button>
          </div>
        </>
      )}
    </div>
  );
}
