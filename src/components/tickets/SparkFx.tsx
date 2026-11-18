import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./tickets.module.css";

/**
 * Kıvılcım efekti: SVG şimşek + dal + halka + kıvılcım noktaları (yalnız transform/opacity/stroke-dashoffset).
 * `fill` verilirse kapsayanın tamamını kaplar (teklif kartı); verilmezse düğmenin çevresine taşar.
 * Kapsayan `position: relative` olmalıdır. Azaltılmış harekette CSS efekti göstermez.
 */
export function SparkFx({ on, fill = false }: { on: boolean; fill?: boolean }) {
  return (
    <svg
      className={`${styles.fx} ${fill ? styles.fxFill : ""} ${on ? styles.fxOn : ""}`}
      viewBox="0 0 200 80"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle className={styles.ring} cx="100" cy="40" r="26" />
      <polyline className={styles.glow} points="10,40 60,18 80,44 120,12 150,46 190,30" />
      <polyline className={styles.bolt} points="10,40 60,18 80,44 120,12 150,46 190,30" />
      <polyline className={styles.branch} points="80,44 96,66 118,58" />
      <polyline className={styles.branch} points="120,12 138,4 156,10" />
      <polyline className={styles.branch} points="60,18 46,6 30,8" />
      <circle className={`${styles.dot} ${styles.dot1}`} cx="60" cy="18" r="4" />
      <circle className={`${styles.dot} ${styles.dot2}`} cx="120" cy="12" r="3" />
      <circle className={`${styles.dot} ${styles.dot3}`} cx="150" cy="46" r="4" />
    </svg>
  );
}

/** Azaltılmış hareket tercihi (efekt bekletmeden doğrudan geçiş için). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Kabul efektinin süresi (ms). */
export const ACCEPT_FX_MS = 800;

function AcceptOverlay({ message }: { message: string }) {
  // Canlı bölge önce boş eklenir, metin sonra yazılır (ekran okuyucular yalnız değişimi duyurur).
  const [text, setText] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setText(message), 50);
    return () => clearTimeout(t);
  }, [message]);
  return (
    <div className={styles.acceptFx} aria-hidden={false}>
      <div className={styles.acceptFxBox}>
        <SparkFx on fill />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {text}
      </p>
    </div>
  );
}

/**
 * Ticket kabul efekti: ekranın ortasında ~800ms şimşek + sonra "alındı" duyurusu. Kart sayfa yenilenince
 * (sunucu eylemi) kaldırılabildiği için efekt kartın içinde değil, kendi kökünde (body'ye eklenir) çalışır.
 * Azaltılmış harekette görsel efekt yoktur (CSS), duyuru yine yapılır.
 */
export function playAcceptFx(message: string) {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<AcceptOverlay message={message} />);
  setTimeout(() => {
    root.unmount();
    host.remove();
  }, 3000);
}
