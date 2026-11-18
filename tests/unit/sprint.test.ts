import { describe, expect, it } from "vitest";
import { dayPhases, lampFor, localDateString, sprintDay, themeFor } from "../../src/lib/sprint";

describe("sprintDay", () => {
  it("başlangıç günü 1 dir", () => {
    expect(sprintDay("2026-11-01", 21, "2026-11-01")).toBe(1);
  });
  it("sonraki günler artar", () => {
    expect(sprintDay("2026-11-01", 21, "2026-11-08")).toBe(8);
    expect(sprintDay("2026-11-01", 21, "2026-11-21")).toBe(21);
  });
  it("başlangıçtan önce 1 e sabitlenir", () => {
    expect(sprintDay("2026-11-10", 21, "2026-11-01")).toBe(1);
  });
  it("bitişten sonra lengthDays e sabitlenir", () => {
    expect(sprintDay("2026-11-01", 21, "2027-03-01")).toBe(21);
  });
  it("ay sınırını doğru geçer", () => {
    expect(sprintDay("2026-10-30", 21, "2026-11-02")).toBe(4);
  });
});

describe("tema ve lamba (21 gün)", () => {
  it("1-7 mavi/yeşil", () => {
    for (let d = 1; d <= 7; d++) {
      expect(themeFor(d, 21)).toBe("blue");
      expect(lampFor(d, 21)).toBe("green");
    }
  });
  it("8-14 kehribar/sarı", () => {
    for (let d = 8; d <= 14; d++) {
      expect(themeFor(d, 21)).toBe("amber");
      expect(lampFor(d, 21)).toBe("yellow");
    }
  });
  it("15-21 kırmızı", () => {
    for (let d = 15; d <= 21; d++) {
      expect(themeFor(d, 21)).toBe("red");
      expect(lampFor(d, 21)).toBe("red");
    }
  });
});

describe("farklı sprint sürelerinde üç dilim", () => {
  it.each([
    [14, 4, 9],
    [30, 10, 20],
    [9, 3, 6],
  ])("%i gün: mavi <= %i, kehribar <= %i, sonrası kırmızı", (len, blueEnd, amberEnd) => {
    expect(themeFor(1, len)).toBe("blue");
    expect(themeFor(blueEnd, len)).toBe("blue");
    expect(themeFor(blueEnd + 1, len)).toBe("amber");
    expect(themeFor(amberEnd, len)).toBe("amber");
    expect(themeFor(amberEnd + 1, len)).toBe("red");
    expect(themeFor(len, len)).toBe("red");
  });
  it("10 günde ilk gün mavi, son gün kırmızı, ortada kehribar var", () => {
    expect(themeFor(1, 10)).toBe("blue");
    expect(themeFor(10, 10)).toBe("red");
    expect(dayPhases(10)).toContain(2);
  });
  it("bölünebilen sürelerde dilimler eşit gün sayısındadır", () => {
    const p = dayPhases(30);
    expect(p.filter((x) => x === 1)).toHaveLength(10);
    expect(p.filter((x) => x === 2)).toHaveLength(10);
    expect(p.filter((x) => x === 3)).toHaveLength(10);
  });
});

describe("dayPhases", () => {
  it("uzunluğu sprint süresi kadardır ve azalmaz", () => {
    for (const n of [3, 10, 14, 21, 30]) {
      const p = dayPhases(n);
      expect(p).toHaveLength(n);
      for (let i = 1; i < p.length; i++) expect(p[i]!).toBeGreaterThanOrEqual(p[i - 1]!);
      expect(p[0]).toBe(1);
      expect(p[n - 1]).toBe(3);
    }
  });
});

describe("localDateString (Europe/Istanbul)", () => {
  it("UTC 21:30 İstanbul da ertesi gündür", () => {
    expect(localDateString(new Date("2026-11-18T21:30:00Z"))).toBe("2026-11-19");
  });
  it("UTC 20:59 hâlâ aynı gündür", () => {
    expect(localDateString(new Date("2026-11-18T20:59:00Z"))).toBe("2026-11-18");
  });
  it("UTC 21:00 tam gece yarısıdır", () => {
    expect(localDateString(new Date("2026-11-18T21:00:00Z"))).toBe("2026-11-19");
  });
});
