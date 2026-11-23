import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, rememberedDevices, session, user } from "../../src/db/schema";
import { consumePasswordToken, issuePasswordToken, issueResetLink } from "../../src/server/accounts";
import {
  REMEMBER_COOKIE,
  consumeRememberedDevice,
  createRememberedDevice,
  forgetRememberedDevice,
  hashDeviceToken,
  peekRememberedDevice,
  purgeExpiredRememberedDevices,
} from "../../src/server/remembered-devices";
import { setUserActive } from "../../src/server/users";
import { authRequest, db, makeMainAdmin, makeUser, resetDb } from "../helpers/db";

const PW = "cok-guclu-sifre-1";
const DAY = 86_400_000;

function setCookies(res: Response): string[] {
  return typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
}
/** Yanıttaki bir çerezin değeri (yoksa undefined, silindiyse ""). */
function cookieValue(res: Response, name: string): string | undefined {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`));
  return line === undefined ? undefined : line.slice(name.length + 1).split(";")[0];
}
const devicesOf = (userId: string) => db.select().from(rememberedDevices).where(eq(rememberedDevices.userId, userId));

describe("hatırlanan cihaz (iş mantığı)", () => {
  beforeEach(resetDb);

  it("yalnız özet saklanır; peek ad + kullanıcı adı döner", async () => {
    const u = await makeUser({ username: "ayse", name: "Ayşe Yılmaz" });
    const { token } = await createRememberedDevice(db, u.id, { userAgent: "UA" });
    const [row] = await devicesOf(u.id);
    expect(row!.tokenHash).toBe(hashDeviceToken(token));
    expect(row!.tokenHash).not.toBe(token);
    expect(await peekRememberedDevice(db, token)).toEqual({ name: "Ayşe Yılmaz", username: "ayse" });
    expect(await peekRememberedDevice(db, "bozuk")).toBeNull();
  });

  it("kullanımda token yenilenir; eski token bir daha çalışmaz, süre kayar", async () => {
    const u = await makeUser();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const { token } = await createRememberedDevice(db, u.id, { now: t0 });
    const t1 = new Date(t0.getTime() + 10 * DAY);
    const used = await consumeRememberedDevice(db, token, { now: t1 });
    expect(used?.userId).toBe(u.id);
    expect(used!.token).not.toBe(token);
    expect(used!.expiresAt.getTime()).toBe(t1.getTime() + 60 * DAY);
    // Eski token pencere (30 sn) dışında artık çalışmaz.
    const later = new Date(t1.getTime() + 31_000);
    expect(await consumeRememberedDevice(db, token, { now: later })).toBeNull();
    expect(await consumeRememberedDevice(db, used!.token!, { now: later })).not.toBeNull();
    expect(await devicesOf(u.id)).toHaveLength(1);
  });

  it("süresi dolmuş token reddedilir ve satır silinir", async () => {
    const u = await makeUser();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const { token } = await createRememberedDevice(db, u.id, { now: t0 });
    const late = new Date(t0.getTime() + 61 * DAY);
    expect(await peekRememberedDevice(db, token, late)).toBeNull();
    expect(await consumeRememberedDevice(db, token, { now: late })).toBeNull();
    expect(await devicesOf(u.id)).toHaveLength(0);
  });

  it("pasif kişi bu yolla giriş yapamaz", async () => {
    const u = await makeUser({ active: false });
    const { token } = await createRememberedDevice(db, u.id);
    expect(await peekRememberedDevice(db, token)).toBeNull();
    expect(await consumeRememberedDevice(db, token)).toBeNull();
  });

  it("forget yalnız bu cihazı siler", async () => {
    const u = await makeUser();
    const a = await createRememberedDevice(db, u.id);
    const b = await createRememberedDevice(db, u.id);
    await forgetRememberedDevice(db, a.token);
    expect(await peekRememberedDevice(db, a.token)).toBeNull();
    expect(await peekRememberedDevice(db, b.token)).not.toBeNull();
  });

  it("pasifleştirme, sıfırlama bağlantısı ve şifre değişimi tüm cihazları siler", async () => {
    const admin = await makeMainAdmin();
    const u = await makeUser({ password: PW });

    await createRememberedDevice(db, u.id);
    await setUserActive(db, admin, { userId: u.id, active: false });
    expect(await devicesOf(u.id)).toHaveLength(0);
    await setUserActive(db, admin, { userId: u.id, active: true });

    await createRememberedDevice(db, u.id);
    await issueResetLink(db, admin, u.id);
    expect(await devicesOf(u.id)).toHaveLength(0);

    await createRememberedDevice(db, u.id);
    const { token } = await issuePasswordToken(db, u.id, "reset", admin.id);
    await createRememberedDevice(db, u.id);
    await consumePasswordToken(db, token, "yeni-guclu-sifre-2");
    expect(await devicesOf(u.id)).toHaveLength(0);
  });
});

describe("hatırlanan cihaz (yarış, pencere, temizlik)", () => {
  beforeEach(resetDb);

  it("aynı token'la eşzamanlı iki kullanım: biri yeniler, diğeri çereze dokunmadan geçer; cihaz geçerli kalır", async () => {
    const u = await makeUser();
    const { token } = await createRememberedDevice(db, u.id);
    const results = await Promise.all([consumeRememberedDevice(db, token), consumeRememberedDevice(db, token)]);
    expect(results.every((r) => r?.userId === u.id)).toBe(true);
    const winners = results.filter((r) => r!.token !== null);
    expect(winners).toHaveLength(1);
    const newest = winners[0]!.token!;
    const [row] = await devicesOf(u.id);
    expect(row!.tokenHash).toBe(hashDeviceToken(newest));
    expect(row!.previousTokenHash).toBeNull(); // pencere bir kez kullanıldı
    expect(await consumeRememberedDevice(db, newest)).not.toBeNull();
  });

  it("eski token pencere içinde bir kez kabul edilir, ikinci kez ve pencere dışında reddedilir", async () => {
    const u = await makeUser();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const { token } = await createRememberedDevice(db, u.id, { now: t0 });
    const first = await consumeRememberedDevice(db, token, { now: t0 });
    const grace = await consumeRememberedDevice(db, token, { now: new Date(t0.getTime() + 5_000) });
    expect(grace).toMatchObject({ userId: u.id, token: null });
    expect(await consumeRememberedDevice(db, token, { now: new Date(t0.getTime() + 6_000) })).toBeNull();

    // Yeni yenileme; eski token 30 sn sonra artık geçmez.
    const second = await consumeRememberedDevice(db, first!.token!, { now: t0 });
    expect(await consumeRememberedDevice(db, first!.token!, { now: new Date(t0.getTime() + 31_000) })).toBeNull();
    expect(await consumeRememberedDevice(db, second!.token!, { now: new Date(t0.getTime() + 31_000) })).not.toBeNull();
  });

  it("süresi dolmuş kayıtlar temizlenir (yeni cihaz açılırken de)", async () => {
    const u = await makeUser();
    const t0 = new Date("2026-01-01T00:00:00Z");
    await createRememberedDevice(db, u.id, { now: t0 });
    await createRememberedDevice(db, u.id, { now: t0 });
    const live = await createRememberedDevice(db, u.id, { now: new Date(t0.getTime() + 30 * DAY) });
    await purgeExpiredRememberedDevices(db, new Date(t0.getTime() + 61 * DAY));
    expect(await devicesOf(u.id)).toHaveLength(1);
    expect(await peekRememberedDevice(db, live.token, new Date(t0.getTime() + 61 * DAY))).not.toBeNull();

    await createRememberedDevice(db, u.id, { now: new Date(t0.getTime() + 200 * DAY) });
    expect(await devicesOf(u.id)).toHaveLength(1); // süresi dolan "live" da silindi
  });
});

/** Origin başlığı olmadan (ya da verilenle) ham istek. */
async function rawAuthPost(path: string, headers: Record<string, string>) {
  const { auth } = await import("../../src/lib/auth/auth");
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    }),
  );
}

describe("hatırlanan cihaz (HTTP akışı)", () => {
  beforeEach(resetDb);

  it("tik atılmadan yapılan giriş hatırlama çerezi bırakmaz", async () => {
    const u = await makeUser({ username: "ayse", password: PW });
    const res = await authRequest("/sign-in/username", { username: "ayse", password: PW });
    expect(res.status).toBe(200);
    expect(cookieValue(res, REMEMBER_COOKIE)).toBeUndefined();
    expect(await devicesOf(u.id)).toHaveLength(0);
  });

  it("Beni hatırla → tek tıkla giriş oturum açar, token'ı yeniler, denetime yazar", async () => {
    const u = await makeUser({ username: "ayse", password: PW });
    const login = await authRequest(
      "/sign-in/username",
      { username: "ayse", password: PW },
      { "x-remember-device": "1" },
    );
    expect(login.status).toBe(200);
    const token = cookieValue(login, REMEMBER_COOKIE)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const attrs = setCookies(login).find((c) => c.startsWith(`${REMEMBER_COOKIE}=`))!;
    expect(attrs).toMatch(/HttpOnly/i);
    expect(attrs).toMatch(/SameSite=Lax/i);
    expect(attrs).toMatch(/Max-Age=5184000/);
    await db.delete(session).where(eq(session.userId, u.id)); // çıkış yapılmış gibi

    const quick = await authRequest("/remembered-device/sign-in", {}, { cookie: `${REMEMBER_COOKIE}=${token}` });
    expect(quick.status).toBe(200);
    expect(await quick.json()).toEqual({ ok: true });
    expect(setCookies(quick).join("\n")).toMatch(/session_token=/);
    const rotated = cookieValue(quick, REMEMBER_COOKIE)!;
    expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated).not.toBe(token);
    expect(await db.select().from(session).where(eq(session.userId, u.id))).toHaveLength(1);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "auth.remembered_sign_in"))).toHaveLength(1);

    // Yarışı kaybeden sekme gibi: eski token pencere içinde bir kez geçer, çereze dokunmaz.
    const loser = await authRequest("/remembered-device/sign-in", {}, { cookie: `${REMEMBER_COOKIE}=${token}` });
    expect(await loser.json()).toEqual({ ok: true });
    expect(cookieValue(loser, REMEMBER_COOKIE)).toBeUndefined();
    expect(await peekRememberedDevice(db, rotated)).not.toBeNull();

    // İkinci kez artık çalışmaz; çerez temizlenir, oturum açılmaz.
    const replay = await authRequest("/remembered-device/sign-in", {}, { cookie: `${REMEMBER_COOKIE}=${token}` });
    expect(await replay.json()).toEqual({ ok: false });
    expect(cookieValue(replay, REMEMBER_COOKIE)).toBe("");
    expect(setCookies(replay).join("\n")).not.toMatch(/session_token=[^;]/);
  });

  it("değiştirilmiş / bilinmeyen token ve pasif kişi aynı nötr yanıtı alır", async () => {
    const u = await makeUser({ username: "ayse", password: PW });
    const { token } = await createRememberedDevice(db, u.id);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const r1 = await authRequest("/remembered-device/sign-in", {}, { cookie: `${REMEMBER_COOKIE}=${tampered}` });
    expect(await r1.json()).toEqual({ ok: false });

    await db.update(user).set({ active: false }).where(eq(user.id, u.id));
    const r2 = await authRequest("/remembered-device/sign-in", {}, { cookie: `${REMEMBER_COOKIE}=${token}` });
    expect(await r2.json()).toEqual({ ok: false });
    expect(cookieValue(r2, REMEMBER_COOKIE)).toBe("");
    expect(await db.select().from(session).where(eq(session.userId, u.id))).toHaveLength(0);
  });

  it("Başka bir hesapla: forget satırı siler ve çerezi temizler", async () => {
    const u = await makeUser();
    const { token } = await createRememberedDevice(db, u.id);
    const res = await authRequest("/remembered-device/forget", {}, { cookie: `${REMEMBER_COOKIE}=${token}` });
    expect(res.status).toBe(200);
    expect(cookieValue(res, REMEMBER_COOKIE)).toBe("");
    expect(await devicesOf(u.id)).toHaveLength(0);
  });

  it("tik atılmadan giriş, tarayıcıdaki eski hatırlama kaydını siler", async () => {
    const other = await makeUser();
    const { token } = await createRememberedDevice(db, other.id);
    await makeUser({ username: "ayse", password: PW });
    const res = await authRequest(
      "/sign-in/username",
      { username: "ayse", password: PW },
      { cookie: `${REMEMBER_COOKIE}=${token}` },
    );
    expect(res.status).toBe(200);
    expect(cookieValue(res, REMEMBER_COOKIE)).toBe("");
    expect(await devicesOf(other.id)).toHaveLength(0);
  });

  it("siteler arası / kaynaksız POST reddedilir ve çerezi temizlemez", async () => {
    const u = await makeUser();
    const { token } = await createRememberedDevice(db, u.id);
    for (const path of ["/remembered-device/forget", "/remembered-device/sign-in"]) {
      const cases: Record<string, string>[] = [
        { origin: "https://evil.example" },
        { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        {}, // ne Origin ne Sec-Fetch-Site
        { "sec-fetch-site": "cross-site" },
      ];
      for (const h of cases) {
        // Lax çerez siteler arası gönderilmez; çerezli hâli de denenir.
        for (const withCookie of [false, true]) {
          const res = await rawAuthPost(path, withCookie ? { ...h, cookie: `${REMEMBER_COOKIE}=${token}` } : h);
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(cookieValue(res, REMEMBER_COOKIE)).toBeUndefined();
        }
      }
    }
    expect(await devicesOf(u.id)).toHaveLength(1);
    expect(await peekRememberedDevice(db, token)).not.toBeNull();
  });

  it("çerezsiz aynı kaynaklı istek çerez temizleme başlığı üretmez", async () => {
    for (const path of ["/remembered-device/forget", "/remembered-device/sign-in"]) {
      const res = await rawAuthPost(path, { "sec-fetch-site": "same-origin" });
      expect(res.status).toBe(200);
      expect(cookieValue(res, REMEMBER_COOKIE)).toBeUndefined();
    }
  });
});
