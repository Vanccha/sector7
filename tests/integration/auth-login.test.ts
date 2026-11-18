import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, session } from "../../src/db/schema";
import { authRequest, db, makeUser, resetDb } from "../helpers/db";

describe("kullanıcı adı + şifre ile giriş", () => {
  beforeEach(resetDb);

  it("doğru şifreyle oturum açar ve oturum çerezi verir", async () => {
    await makeUser({ username: "ayse", password: "cok-guclu-sifre-1" });
    const res = await authRequest("/sign-in/username", { username: "ayse", password: "cok-guclu-sifre-1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/session_token=/);
  });

  it("yanlış şifrede 401 döner", async () => {
    await makeUser({ username: "ayse", password: "cok-guclu-sifre-1" });
    const res = await authRequest("/sign-in/username", { username: "ayse", password: "yanlis-sifre-123" });
    expect(res.status).toBe(401);
  });
});

const auditOf = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

/** Set-Cookie başlıklarından çerez satırı (name=value; ...). */
function cookieHeader(res: Response): string {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  return all.map((c) => c.split(";")[0]).join("; ");
}

describe("giriş/çıkış denetim kaydı", () => {
  beforeEach(resetDb);

  it("başarılı girişte auth.sign_in yazılır (actorId = kişi)", async () => {
    const u = await makeUser({ username: "ayse", password: "cok-guclu-sifre-1" });
    const res = await authRequest("/sign-in/username", { username: "ayse", password: "cok-guclu-sifre-1" });
    expect(res.status).toBe(200);
    const rows = await auditOf("auth.sign_in");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: u.id, subjectUserId: u.id, entityType: "session" });
  });

  it("hatalı şifrede auth.sign_in yazılmaz", async () => {
    await makeUser({ username: "ayse", password: "cok-guclu-sifre-1" });
    const res = await authRequest("/sign-in/username", { username: "ayse", password: "yanlis-sifre-123" });
    expect(res.status).toBe(401);
    expect(await auditOf("auth.sign_in")).toHaveLength(0);
  });

  it("pasif kişi giriş yapamaz; oturum ve auth.sign_in kaydı oluşmaz", async () => {
    const u = await makeUser({ username: "pasif", password: "cok-guclu-sifre-1", active: false });
    const res = await authRequest("/sign-in/username", { username: "pasif", password: "cok-guclu-sifre-1" });
    expect(res.status).not.toBe(200);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session_token=/);
    expect(await auditOf("auth.sign_in")).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, u.id))).toHaveLength(0);
  });

  it("sign-out isteği auth.sign_out yazar ve oturumu siler", async () => {
    const u = await makeUser({ username: "ayse", password: "cok-guclu-sifre-1" });
    const signIn = await authRequest("/sign-in/username", { username: "ayse", password: "cok-guclu-sifre-1" });
    expect(signIn.status).toBe(200);
    const cookie = cookieHeader(signIn);
    expect(cookie).toMatch(/session_token=/);
    const out = await authRequest("/sign-out", {}, { cookie });
    expect(out.status).toBe(200);
    const rows = await auditOf("auth.sign_out");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: u.id, subjectUserId: u.id });
    expect(await db.select().from(session).where(eq(session.userId, u.id))).toHaveLength(0);
  });
});
