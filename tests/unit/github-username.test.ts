import { describe, expect, it } from "vitest";
import { applicationInputSchema } from "../../src/lib/contracts/applications";
import { githubUsernameSchema } from "../../src/lib/contracts/github";

describe("githubUsernameSchema", () => {
  it("boş değer null olur", () => {
    expect(githubUsernameSchema.parse("")).toBeNull();
    expect(githubUsernameSchema.parse("   ")).toBeNull();
  });
  it("baştaki @ atılır", () => {
    expect(githubUsernameSchema.parse("@octo-cat")).toBe("octo-cat");
  });
  it("geçerli ad kabul edilir", () => {
    expect(githubUsernameSchema.parse("ok")).toBe("ok");
    expect(githubUsernameSchema.parse("a".repeat(39))).toBe("a".repeat(39));
  });
  it.each(["a--b", "-x", "x-", "a".repeat(40), "a b", "ğ", "a_b"])("%s reddedilir", (v) => {
    expect(githubUsernameSchema.safeParse(v).success).toBe(false);
  });
});

describe("applicationInputSchema.githubUsername", () => {
  const base = {
    fullName: "Ayşe Yılmaz",
    username: "ayse",
    email: "ayse@example.com",
    phone: "0532 123 45 67",
    intro: "Yazılım ve tasarım ile ilgileniyorum, topluluğa katkı vermek istiyorum.",
  };
  it("alan yokken null", () => {
    expect(applicationInputSchema.parse(base).githubUsername).toBeNull();
  });
  it("alan verilince temizlenir", () => {
    expect(applicationInputSchema.parse({ ...base, githubUsername: "@ad" }).githubUsername).toBe("ad");
  });
  it("geçersiz ad reddedilir", () => {
    expect(applicationInputSchema.safeParse({ ...base, githubUsername: "a--b" }).success).toBe(false);
  });
});
