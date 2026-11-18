import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { account, auditLog, passwordTokens, session, user } from "../../src/db/schema";
import {
  consumePasswordToken,
  createMainAdminAccount,
  inspectPasswordToken,
  issuePasswordToken,
  issueResetLink,
  setMainAdmin,
} from "../../src/server/accounts";
import { authRequest, db, makeActor, makeMainAdmin, makeUser, resetDb } from "../helpers/db";
import { expectCode } from "../helpers/errors";

const PW = "cok-guclu-sifre-1";

describe("şifre bağlantıları", () => {
  beforeEach(resetDb);

  it("bağlantı tek kullanımlıktır", async () => {
    const u = await makeUser();
    const { token } = await issuePasswordToken(db, u.id, "setup", null);
    await consumePasswordToken(db, token, PW);
    await expectCode(consumePasswordToken(db, token, "baska-guclu-sifre-2"), "INVALID_STATE");
  });

  it("eşzamanlı iki kullanımdan yalnız biri başarılı", async () => {
    const u = await makeUser();
    const { token } = await issuePasswordToken(db, u.id, "setup", null);
    const res = await Promise.allSettled([
      consumePasswordToken(db, token, "birinci-guclu-sifre"),
      consumePasswordToken(db, token, "ikinci-guclu-sifre"),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rej = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rej[0]!.reason.code).toBe("INVALID_STATE");
  });

  it("süresi dolmuş bağlantı reddedilir", async () => {
    const u = await makeUser();
    const past = new Date(Date.now() - 30 * 24 * 3_600_000);
    const { token } = await issuePasswordToken(db, u.id, "setup", null, past);
    expect(await inspectPasswordToken(db, token)).toBeNull();
    await expectCode(consumePasswordToken(db, token, PW), "INVALID_STATE");
  });

  it("inspectPasswordToken geçerli ve geçersiz bağlantıyı ayırt eder", async () => {
    const u = await makeUser({ username: "ayse" });
    const { token } = await issuePasswordToken(db, u.id, "setup", null);
    const info = await inspectPasswordToken(db, token);
    expect(info?.username).toBe("ayse");
    expect(info?.purpose).toBe("setup");
    expect(await inspectPasswordToken(db, "yok-boyle-bir-token-x".repeat(2))).toBeNull();
    await consumePasswordToken(db, token, PW);
    expect(await inspectPasswordToken(db, token)).toBeNull();
  });

  it("yeni bağlantı üretilince eski kullanılmamış bağlantı geçersiz olur", async () => {
    const u = await makeUser();
    const first = await issuePasswordToken(db, u.id, "setup", null);
    const second = await issuePasswordToken(db, u.id, "reset", null);
    expect(await inspectPasswordToken(db, first.token)).toBeNull();
    await expectCode(consumePasswordToken(db, first.token, PW), "INVALID_STATE");
    expect(await inspectPasswordToken(db, second.token)).not.toBeNull();
  });

  it("başka kişinin bağlantısı etkilenmez", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const ta = await issuePasswordToken(db, a.id, "setup", null);
    await issuePasswordToken(db, b.id, "setup", null);
    expect(await inspectPasswordToken(db, ta.token)).not.toBeNull();
  });

  it("veritabanında ham token değil özeti saklanır", async () => {
    const u = await makeUser();
    const { token } = await issuePasswordToken(db, u.id, "setup", null);
    const rows = await db.select().from(passwordTokens).where(eq(passwordTokens.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("şifre argon2id ile saklanır, düz şifre saklanmaz", async () => {
    const u = await makeUser();
    const { token } = await issuePasswordToken(db, u.id, "setup", null);
    await consumePasswordToken(db, token, PW);
    const [acc] = await db.select().from(account).where(eq(account.userId, u.id));
    expect(acc?.providerId).toBe("credential");
    expect(acc?.password).toMatch(/^\$argon2id\$/);
    expect(acc?.password).not.toContain(PW);
  });

  it("kısa şifre bağlantıyı tüketmez ve hata verir", async () => {
    const u = await makeUser();
    const { token } = await issuePasswordToken(db, u.id, "setup", null);
    await expect(consumePasswordToken(db, token, "kisa")).rejects.toBeTruthy();
    expect(await inspectPasswordToken(db, token)).not.toBeNull();
  });
});

describe("şifre sıfırlama", () => {
  beforeEach(resetDb);

  it("issueResetLink yalnız ana yönetici için", async () => {
    const admin = await makeMainAdmin();
    const member = await makeActor();
    const target = await makeUser();
    await expectCode(issueResetLink(db, member, target.id), "FORBIDDEN");
    await expectCode(issueResetLink(db, null, target.id), "UNAUTHENTICATED");
    const link = await issueResetLink(db, admin, target.id);
    expect(link.url).toContain("/sifre/");
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "user.reset_link_issued"));
    expect(logs).toHaveLength(1);
  });

  it("olmayan kişi için NOT_FOUND", async () => {
    const admin = await makeMainAdmin();
    await expectCode(issueResetLink(db, admin, "00000000-0000-4000-8000-000000000000"), "NOT_FOUND");
  });

  it("sıfırlama bağlantısı kullanılınca oturumlar silinir", async () => {
    const admin = await makeMainAdmin();
    const target = await makeUser({ username: "ayse", password: PW });
    const login = await authRequest("/sign-in/username", { username: "ayse", password: PW });
    expect(login.status).toBe(200);
    expect((await db.select().from(session).where(eq(session.userId, target.id))).length).toBeGreaterThan(0);

    const link = await issueResetLink(db, admin, target.id);
    await consumePasswordToken(db, link.url.split("/sifre/")[1]!, "yepyeni-guclu-sifre");
    expect(await db.select().from(session).where(eq(session.userId, target.id))).toHaveLength(0);

    const old = await authRequest("/sign-in/username", { username: "ayse", password: PW });
    expect(old.status).toBe(401);
    const fresh = await authRequest("/sign-in/username", { username: "ayse", password: "yepyeni-guclu-sifre" });
    expect(fresh.status).toBe(200);
  });
});

describe("setMainAdmin", () => {
  beforeEach(resetDb);

  it("ana yönetici yetki verir ve denetim kaydı düşer", async () => {
    const admin = await makeMainAdmin();
    const target = await makeUser();
    await setMainAdmin(db, admin, target.id, true);
    const [u] = await db.select().from(user).where(eq(user.id, target.id));
    expect(u?.isMainAdmin).toBe(true);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "user.grant_main_admin"))).toHaveLength(1);
  });

  it("yetkiyi geri alır ve denetim kaydı düşer", async () => {
    const admin = await makeMainAdmin();
    const target = await makeUser({ isMainAdmin: true });
    await setMainAdmin(db, admin, target.id, false);
    const [u] = await db.select().from(user).where(eq(user.id, target.id));
    expect(u?.isMainAdmin).toBe(false);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "user.revoke_main_admin"))).toHaveLength(1);
  });

  it("üye FORBIDDEN, oturumsuz UNAUTHENTICATED", async () => {
    const member = await makeActor();
    const target = await makeUser();
    await expectCode(setMainAdmin(db, member, target.id, true), "FORBIDDEN");
    await expectCode(setMainAdmin(db, null, target.id, true), "UNAUTHENTICATED");
    const [u] = await db.select().from(user).where(eq(user.id, target.id));
    expect(u?.isMainAdmin).toBe(false);
  });

  it("kendi yetkisini kaldıramaz", async () => {
    const admin = await makeMainAdmin();
    await expectCode(setMainAdmin(db, admin, admin.id, false), "INVALID_STATE");
    const [u] = await db.select().from(user).where(eq(user.id, admin.id));
    expect(u?.isMainAdmin).toBe(true);
  });
});

describe("createMainAdminAccount", () => {
  beforeEach(resetDb);

  const adminInput = { username: "kurucu", name: "Kurucu", email: "kurucu@example.com", password: PW };

  it("yeni ana yönetici oluşturur ve giriş yapabilir", async () => {
    const r = await createMainAdminAccount(db, adminInput);
    expect(r.created).toBe(true);
    const [u] = await db.select().from(user).where(eq(user.id, r.userId));
    expect(u?.isMainAdmin).toBe(true);
    const login = await authRequest("/sign-in/username", { username: "kurucu", password: PW });
    expect(login.status).toBe(200);
  });

  it("mevcut kullanıcıyı ana yönetici yapar", async () => {
    const existing = await makeUser({ username: "kurucu" });
    const r = await createMainAdminAccount(db, adminInput);
    expect(r.created).toBe(false);
    expect(r.userId).toBe(existing.id);
    const [u] = await db.select().from(user).where(eq(user.id, existing.id));
    expect(u?.isMainAdmin).toBe(true);
  });

  it("ikinci çağrı yinelenen kullanıcı açmaz", async () => {
    await createMainAdminAccount(db, adminInput);
    const r2 = await createMainAdminAccount(db, adminInput);
    expect(r2.created).toBe(false);
    expect(await db.select().from(user).where(eq(user.username, "kurucu"))).toHaveLength(1);
    expect(await db.select().from(account)).toHaveLength(1);
  });
});

describe("pasif kullanıcı", () => {
  beforeEach(resetDb);

  it("doğru şifreyle de oturum açamaz", async () => {
    const u = await makeUser({ username: "ayse", password: PW, active: false });
    const res = await authRequest("/sign-in/username", { username: "ayse", password: PW });
    expect(res.status).not.toBe(200);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session_token=/);
    expect(await db.select().from(session).where(eq(session.userId, u.id))).toHaveLength(0);
  });
});
