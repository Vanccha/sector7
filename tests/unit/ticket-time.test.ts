import { describe, expect, it } from "vitest";
import { OFFER_MINUTES } from "../../src/lib/contracts/tickets";
import {
  flagsFor,
  isExpired,
  isOfferExpired,
  offerExpiresAt,
  remainingMs,
  requestReminderAt,
  resumeTimes,
  warnAt,
} from "../../src/lib/ticket-time";

const H = 3_600_000;
const T0 = new Date("2026-11-18T09:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("remainingMs / isExpired", () => {
  it("duraklı değilken dueAt - now", () => {
    expect(remainingMs({ dueAt: at(10 * H), pausedAt: null }, at(2 * H))).toBe(8 * H);
  });
  it("duraklıyken now ilerlese de donuk (dueAt - pausedAt)", () => {
    const t = { dueAt: at(10 * H), pausedAt: at(4 * H) };
    expect(remainingMs(t, at(5 * H))).toBe(6 * H);
    expect(remainingMs(t, at(50 * H))).toBe(6 * H);
  });
  it("dueAt yoksa null", () => {
    expect(remainingMs({ dueAt: null, pausedAt: null }, T0)).toBeNull();
  });
  it("isExpired: süre doldu / dolmadı, duraklıyken dolmaz", () => {
    expect(isExpired({ dueAt: at(H), pausedAt: null }, at(2 * H))).toBe(true);
    expect(isExpired({ dueAt: at(3 * H), pausedAt: null }, at(2 * H))).toBe(false);
    expect(isExpired({ dueAt: at(3 * H), pausedAt: at(H) }, at(100 * H))).toBe(false);
  });
});

describe("resumeTimes", () => {
  const base = { warnedAt: null, expiredNotifiedAt: null };
  it("dueAt duraklama süresi kadar ileri itilir, pausedAt null", () => {
    const r = resumeTimes({ dueAt: at(72 * H), pausedAt: at(10 * 1000), ...base }, at(30 * 1000), 12);
    expect(r.dueAt!.getTime()).toBe(at(72 * H).getTime() + 20 * 1000);
    expect(r.pausedAt).toBeNull();
  });
  it("extraHours ek olarak eklenir", () => {
    const r = resumeTimes({ dueAt: at(72 * H), pausedAt: at(0), ...base }, at(2 * H), 12, 5);
    expect(r.dueAt!.getTime()).toBe(at(72 * H + 2 * H + 5 * H).getTime());
    expect(r.pausedAt).toBeNull();
  });
  it("duraklı değilse yalnız extraHours eklenir", () => {
    const r = resumeTimes({ dueAt: at(72 * H), pausedAt: null, ...base }, at(2 * H), 12, 3);
    expect(r.dueAt!.getTime()).toBe(at(75 * H).getTime());
  });
  it("devam sonrası geleceğe kayan dueAt için uyarı işaretleri temizlenir", () => {
    const r = resumeTimes(
      { dueAt: at(5 * H), pausedAt: at(H), warnedAt: at(H), expiredNotifiedAt: at(H) },
      at(2 * H),
      12,
      100,
    );
    expect(r.warnedAt).toBeNull();
    expect(r.expiredNotifiedAt).toBeNull();
  });
});

describe("flagsFor", () => {
  const prev = { warnedAt: at(1), expiredNotifiedAt: at(2) };
  it("dueAt uyarı penceresinden uzaksa warnedAt temizlenir", () => {
    expect(flagsFor(at(100 * H), at(0), 12, prev).warnedAt).toBeNull();
  });
  it("dueAt uyarı penceresi içindeyse warnedAt korunur", () => {
    expect(flagsFor(at(5 * H), at(0), 12, prev).warnedAt).toEqual(at(1));
  });
  it("dueAt gelecekteyse expiredNotifiedAt temizlenir", () => {
    expect(flagsFor(at(5 * H), at(0), 12, prev).expiredNotifiedAt).toBeNull();
  });
  it("dueAt geçmişteyse her iki işaret korunur", () => {
    const r = flagsFor(at(-H), at(0), 12, prev);
    expect(r.warnedAt).toEqual(at(1));
    expect(r.expiredNotifiedAt).toEqual(at(2));
  });
});

describe("teklif ve hatırlatma zamanları", () => {
  it("teklif süresi 30 dk", () => {
    expect(OFFER_MINUTES).toBe(30);
    expect(offerExpiresAt(T0).getTime()).toBe(T0.getTime() + 30 * 60_000);
    expect(isOfferExpired(T0, at(29 * 60_000))).toBe(false);
    expect(isOfferExpired(T0, at(31 * 60_000))).toBe(true);
  });
  it("warnAt = dueAt - saat", () => {
    expect(warnAt(at(72 * H), 12).getTime()).toBe(at(60 * H).getTime());
  });
  it("requestReminderAt = respondBy - süre/4", () => {
    expect(requestReminderAt(at(24 * H), 24).getTime()).toBe(at(18 * H).getTime());
    expect(requestReminderAt(at(8 * H), 8).getTime()).toBe(at(6 * H).getTime());
  });
});
