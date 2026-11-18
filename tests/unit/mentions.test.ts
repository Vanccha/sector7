import { describe, expect, it } from "vitest";
import { mentionCandidates } from "../../src/lib/contracts/messaging";

describe("mentionCandidates", () => {
  it("@ali bulunur", () => {
    expect(mentionCandidates("merhaba @ali nasılsın")).toEqual(["ali"]);
    expect(mentionCandidates("@ali")).toEqual(["ali"]);
  });

  it("e-posta adresi bahsetme sayılmaz", () => {
    expect(mentionCandidates("yaz: ali@ornek.com")).toEqual([]);
    expect(mentionCandidates("a.b_c@ornek.com ve x1@y.org")).toEqual([]);
  });

  it("cümle sonu noktası: hem ham hem noktasız aday", () => {
    const c = mentionCandidates("teşekkürler @ali.");
    expect(c).toContain("ali.");
    expect(c).toContain("ali");
  });

  it("büyük harf küçültülür", () => {
    expect(mentionCandidates("@ALi ve @Veli_K")).toEqual(["ali", "veli_k"]);
  });

  it("3 karakterden kısa alınmaz", () => {
    expect(mentionCandidates("@ab @a @")).toEqual([]);
    expect(mentionCandidates("@abc")).toEqual(["abc"]);
  });

  it("30 karakter sınırı: 30 alınır, 31+ alınmaz", () => {
    expect(mentionCandidates(`@${"a".repeat(30)}`)).toEqual(["a".repeat(30)]);
    expect(mentionCandidates(`@${"a".repeat(31)}`)).toEqual([]);
  });

  it("tekrarsız", () => {
    expect(mentionCandidates("@ali @ali @ALI")).toEqual(["ali"]);
  });

  it("birden çok farklı kişi", () => {
    expect(mentionCandidates("@ali, @veli ve @ayse_01!").sort()).toEqual(["ali", "ayse_01", "veli"].sort());
  });
});
