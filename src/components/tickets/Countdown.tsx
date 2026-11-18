"use client";
import { useSyncExternalStore } from "react";
import type { Countdown as CountdownData } from "@/lib/contracts/tickets";

/** Paylaşılan saat: tüm geri sayımlar 30 sn'de bir birlikte güncellenir. Sunucuda null. */
let clockNow = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  clockNow = Date.now();
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
const clockSnapshot = () => clockNow;

/** Kalan süreyi "2g 5s", "5s 12dk", "12dk" biçiminde yazar. Negatifse "süre doldu". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "süre doldu";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}g ${h}s`;
  if (h > 0) return `${h}s ${m}dk`;
  return `${Math.max(1, m)}dk`;
}

export function remainingFrom(c: CountdownData, nowMs: number): number | null {
  if (!c.dueAt) return null;
  const ref = c.pausedAt ? Date.parse(c.pausedAt) : nowMs;
  return Date.parse(c.dueAt) - ref;
}

/**
 * Geri sayım rozeti (SÖZLEŞME: üye ve yönetici ekranları ortak kullanır).
 * Duraklıysa "durdu" der ve donuk kalan süreyi gösterir. warnBeforeHours altında vurgulanır.
 */
export function Countdown({
  countdown,
  warnBeforeHours = 12,
  size = "md",
}: {
  countdown: CountdownData;
  warnBeforeHours?: number;
  size?: "sm" | "md" | "lg";
}) {
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, () => null);

  if (!countdown.dueAt) return null;
  // İlk çizimde (sunucu) şimdi bilinmiyor; hidrasyon farkı olmasın diye boş yer tutucu.
  if (now === null) {
    return <span className={`countdown countdown--${size}`} aria-hidden="true">&nbsp;</span>;
  }
  const ms = remainingFrom(countdown, now) ?? 0;
  const paused = !!countdown.pausedAt;
  const state = ms <= 0 ? "over" : ms <= warnBeforeHours * 3_600_000 ? "low" : "ok";
  const color = state === "over" || state === "low" ? "var(--hot-tx)" : "var(--ac-tx)";
  const fontSize = size === "lg" ? 28 : size === "sm" ? 12 : 15;
  return (
    <span
      className={`countdown countdown--${size}`}
      data-state={state}
      data-paused={paused || undefined}
      title={new Date(countdown.dueAt).toLocaleString("tr-TR")}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        fontVariantNumeric: "tabular-nums",
        fontWeight: 700,
        fontSize,
        color: paused ? "var(--mut)" : color,
        flexWrap: "wrap",
        maxWidth: "100%",
      }}
    >
      <span style={{ whiteSpace: "nowrap" }}>{formatRemaining(ms)}</span>
      {paused && <span style={{ fontSize: Math.max(11, fontSize - 4), fontWeight: 500 }}>· durdu (cevap bekleniyor)</span>}
    </span>
  );
}
