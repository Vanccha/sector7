import { beforeEach, describe, expect, it } from "vitest";
import { authRequest, makeUser, resetDb } from "../helpers/db";

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
