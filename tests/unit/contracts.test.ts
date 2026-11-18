import { describe, expect, it } from "vitest";
import { applicationInputSchema, setPasswordSchema } from "../../src/lib/contracts/applications";

const valid = {
  fullName: "Ayşe Yılmaz",
  username: "ayse",
  email: "ayse@example.com",
  phone: "0532 123 45 67",
  intro: "Yazılım ve tasarım ile ilgileniyorum, topluluğa katkı vermek istiyorum.",
};

describe("applicationInputSchema", () => {
  it("geçerli girdiyi kabul eder", () => {
    expect(applicationInputSchema.safeParse(valid).success).toBe(true);
  });
  it("kullanıcı adını küçük harfe çevirir", () => {
    expect(applicationInputSchema.parse({ ...valid, username: "AyseY" }).username).toBe("aysey");
  });
  it.each(["a b c", "ay", "ayşe", "ayse-y", "ayse@x", "x".repeat(31)])("geçersiz kullanıcı adı reddedilir: %s", (u) => {
    expect(applicationInputSchema.safeParse({ ...valid, username: u }).success).toBe(false);
  });
  it("e-postayı küçük harfe çevirir", () => {
    expect(applicationInputSchema.parse({ ...valid, email: " Ayse@Example.COM " }).email).toBe("ayse@example.com");
  });
  it("geçersiz e-postayı reddeder", () => {
    expect(applicationInputSchema.safeParse({ ...valid, email: "yok" }).success).toBe(false);
  });
  it("telefondan boşluk, tire ve parantezi temizler", () => {
    expect(applicationInputSchema.parse({ ...valid, phone: "+90 (532) 123-45-67" }).phone).toBe("+905321234567");
    expect(applicationInputSchema.parse(valid).phone).toBe("05321234567");
  });
  it("geçersiz telefonu reddeder", () => {
    expect(applicationInputSchema.safeParse({ ...valid, phone: "123" }).success).toBe(false);
    expect(applicationInputSchema.safeParse({ ...valid, phone: "abc" }).success).toBe(false);
  });
  it("kısa tanıtımı reddeder", () => {
    expect(applicationInputSchema.safeParse({ ...valid, intro: "çok kısa" }).success).toBe(false);
  });
});

describe("setPasswordSchema", () => {
  const token = "t".repeat(43);
  it("geçerli girdiyi kabul eder", () => {
    expect(setPasswordSchema.safeParse({ token, password: "cok-guclu-sifre", passwordRepeat: "cok-guclu-sifre" }).success).toBe(true);
  });
  it("eşleşmeyen şifreyi reddeder", () => {
    const r = setPasswordSchema.safeParse({ token, password: "cok-guclu-sifre", passwordRepeat: "baska-sifre-123" });
    expect(r.success).toBe(false);
  });
  it("10 karakterden kısa şifreyi reddeder", () => {
    expect(setPasswordSchema.safeParse({ token, password: "kisa123", passwordRepeat: "kisa123" }).success).toBe(false);
  });
  it("tam 10 karakteri kabul eder", () => {
    expect(setPasswordSchema.safeParse({ token, password: "1234567890", passwordRepeat: "1234567890" }).success).toBe(true);
  });
});
