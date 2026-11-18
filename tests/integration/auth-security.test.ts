import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { user } from "../../src/db/schema";
import { authRequest, db, makeUser, resetDb } from "../helpers/db";

describe("kayıt ve e-posta girişi kapalı", () => {
  beforeEach(resetDb);

  it("/sign-up/email başarısız olur ve kullanıcı oluşmaz", async () => {
    const res = await authRequest("/sign-up/email", {
      email: "yabanci@example.com",
      password: "cok-guclu-sifre-1",
      name: "Yabancı",
      username: "yabanci",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(user).where(eq(user.email, "yabanci@example.com"))).toHaveLength(0);
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("/sign-in/email başarısız olur", async () => {
    await makeUser({ username: "ayse", email: "ayse@example.com", password: "cok-guclu-sifre-1" });
    const res = await authRequest("/sign-in/email", { email: "ayse@example.com", password: "cok-guclu-sifre-1" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session_token=/);
  });
});

describe("giriş hız sınırı", () => {
  beforeEach(resetDb);

  it("aynı IP den 10 dan fazla denemede 429, farklı IP etkilenmez", async () => {
    await makeUser({ username: "ayse", password: "cok-guclu-sifre-1" });
    const ip = { "x-forwarded-for": "203.0.113.10" };
    const bad = { username: "ayse", password: "yanlis-sifre-123" };
    for (let i = 0; i < 10; i++) {
      const r = await authRequest("/sign-in/username", bad, ip);
      expect(r.status, `deneme ${i + 1}`).toBe(401);
    }
    const blocked = await authRequest("/sign-in/username", bad, ip);
    expect(blocked.status).toBe(429);
    // Doğru şifre de engellenir.
    const blockedGood = await authRequest("/sign-in/username", { username: "ayse", password: "cok-guclu-sifre-1" }, ip);
    expect(blockedGood.status).toBe(429);

    const other = await authRequest(
      "/sign-in/username",
      { username: "ayse", password: "cok-guclu-sifre-1" },
      { "x-forwarded-for": "203.0.113.99" },
    );
    expect(other.status).toBe(200);
  });
});

describe("kullanıcı adı büyük/küçük harf duyarsız", () => {
  beforeEach(resetDb);

  it("AYSE ile ayse hesabına girilir", async () => {
    await makeUser({ username: "ayse", password: "cok-guclu-sifre-1" });
    const res = await authRequest("/sign-in/username", { username: "AYSE", password: "cok-guclu-sifre-1" });
    expect(res.status).toBe(200);
  });
});
