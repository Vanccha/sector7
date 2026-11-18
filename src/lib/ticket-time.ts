/**
 * Ticket geri sayımı ve talep süreleri — saf fonksiyonlar (SÖZLEŞME). Tüm süre hesapları buradan geçer.
 *
 * Model: `dueAt` teslim son anıdır. Talep beklerken `pausedAt` dolar ve geri sayım donar
 * (kalan = dueAt - pausedAt). Devam ederken dueAt duraklama süresi kadar ileri itilir ve pausedAt temizlenir.
 */
import { OFFER_MINUTES } from "./contracts/tickets";

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * MINUTE);

/** Kalan süre (ms). Negatifse süre dolmuş. dueAt yoksa null. */
export function remainingMs(t: { dueAt: Date | null; pausedAt: Date | null }, now: Date): number | null {
  if (!t.dueAt) return null;
  const ref = t.pausedAt ?? now;
  return t.dueAt.getTime() - ref.getTime();
}

export function isExpired(t: { dueAt: Date | null; pausedAt: Date | null }, now: Date): boolean {
  const r = remainingMs(t, now);
  return r !== null && r <= 0;
}

export const offerExpiresAt = (offeredAt: Date) => addMinutes(offeredAt, OFFER_MINUTES);
export const isOfferExpired = (offeredAt: Date, now: Date) => offerExpiresAt(offeredAt).getTime() <= now.getTime();

/** Uyarının gideceği an: dueAt - warnBeforeHours. */
export const warnAt = (dueAt: Date, warnBeforeHours: number) => addHours(dueAt, -warnBeforeHours);

/** Yöneticiye hatırlatma anı: cevap süresinin son çeyreği başlarken. */
export const requestReminderAt = (respondBy: Date, managerResponseHours: number) =>
  new Date(respondBy.getTime() - (managerResponseHours * HOUR) / 4);

/**
 * Duraklamayı bitirir. `extraHours` (ek süre onayı) kadar ayrıca uzatır.
 * dueAt ileri gittiği için artık geçerli olmayan uyarı işaretlerini temizler.
 * Ticket duraklı değilse yalnız extraHours eklenir.
 */
export function resumeTimes(
  t: { dueAt: Date | null; pausedAt: Date | null; warnedAt: Date | null; expiredNotifiedAt: Date | null },
  now: Date,
  warnBeforeHours: number,
  extraHours = 0,
): { dueAt: Date | null; pausedAt: null; warnedAt: Date | null; expiredNotifiedAt: Date | null } {
  if (!t.dueAt) return { dueAt: null, pausedAt: null, warnedAt: t.warnedAt, expiredNotifiedAt: t.expiredNotifiedAt };
  const pausedFor = t.pausedAt ? Math.max(0, now.getTime() - t.pausedAt.getTime()) : 0;
  const dueAt = new Date(t.dueAt.getTime() + pausedFor + extraHours * HOUR);
  return { dueAt, pausedAt: null, ...flagsFor(dueAt, now, warnBeforeHours, t) };
}

/** Yeni bir dueAt için uyarı işaretlerinden hangileri korunur. */
export function flagsFor(
  dueAt: Date,
  now: Date,
  warnBeforeHours: number,
  prev: { warnedAt: Date | null; expiredNotifiedAt: Date | null },
): { warnedAt: Date | null; expiredNotifiedAt: Date | null } {
  return {
    warnedAt: warnAt(dueAt, warnBeforeHours).getTime() > now.getTime() ? null : prev.warnedAt,
    expiredNotifiedAt: dueAt.getTime() > now.getTime() ? null : prev.expiredNotifiedAt,
  };
}
