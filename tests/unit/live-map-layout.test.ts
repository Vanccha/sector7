import { describe, expect, it } from "vitest";
import type { LiveMap } from "../../src/lib/contracts/live-map";
import { layoutHasOverlap, layoutLiveMap, linkCrossesForeignHex, linkCrossesOtherPerson } from "../../src/lib/live-map-layout";

const area = (id: string, name: string, activeCount = 0) => ({ id, name, archived: false, activeCount, managerName: null });
const person = (id: string, name: string) => ({ id, name, homeAreaId: null });
const link = (userId: string, areaId: string) => ({
  ticketId: `t-${userId}`,
  title: "İş",
  areaId,
  userId,
  status: "taken" as const,
  takenAt: null,
  paused: false,
});

/** Demo benzeri: 7 alan (3 aktif), 6 kişi, her kişi tek alanda (Web'de 3 kişi). */
function demo(): LiveMap {
  const areas = [
    area("m", "Demo · Mobil", 1),
    area("t", "Demo · Tasarım", 2),
    area("w", "Demo · Web", 3),
    area("d", "Donanım"),
    area("i", "İçerik"),
    area("s", "Tasarım"),
    area("y", "Yazılım"),
  ];
  const people = ["Burak", "Ceren", "Deniz", "Emre", "Selin", "Zeynep"].map((n) => person(n[0]!.toLowerCase() + "p", n));
  const links = [link("dp", "m"), link("sp", "t"), link("bp", "t"), link("cp", "w"), link("ep", "w"), link("zp", "w")];
  return { areas, people, links, generatedAt: "2026-11-19T09:00:00.000Z" };
}

describe("şema yerleşimi: kişiler kendi alanının önünde", () => {
  const map = demo();
  const L = layoutLiveMap(map);
  const c = { x: L.width / 2, y: L.height / 2 };
  const r = (p: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y);
  const angle = (p: { x: number; y: number }) => Math.atan2(p.y - c.y, p.x - c.x);

  it("alanlar merkez etrafında eşit yarıçapta; kişiler halkanın içinde", () => {
    const ra = L.areas.map(r);
    expect(Math.max(...ra) - Math.min(...ra)).toBeLessThanOrEqual(2);
    for (const p of L.people) expect(r(p)).toBeLessThan(Math.min(...ra));
  });

  it("her kişi kendi alanına diğer tüm alanlardan daha yakın; çizgi altıgen ve kişi kesmez", () => {
    for (const l of L.links) {
      const p = L.people.find((x) => x.id === l.userId)!;
      const own = L.areas.find((a) => a.id === l.areaId)!;
      const dOwn = Math.hypot(p.x - own.x, p.y - own.y);
      for (const a of L.areas) if (a.id !== own.id) expect(dOwn).toBeLessThan(Math.hypot(p.x - a.x, p.y - a.y));
      expect(linkCrossesForeignHex(L, l)).toBe(false);
      expect(linkCrossesOtherPerson(L, l)).toBe(false);
    }
    expect(layoutHasOverlap(L)).toBe(false);
  });

  it("aynı alandaki kişiler alan yönünde simetrik sıra", () => {
    const web = L.areas.find((a) => a.id === "w")!;
    const ws = L.people.filter((p) => ["cp", "ep", "zp"].includes(p.id));
    const mean = Math.atan2(
      ws.reduce((s, p) => s + Math.sin(angle(p)), 0),
      ws.reduce((s, p) => s + Math.cos(angle(p)), 0),
    );
    const diff = Math.abs(Math.atan2(Math.sin(mean - angle(web)), Math.cos(mean - angle(web))));
    expect(diff).toBeLessThan(0.05);
  });

  it("deterministik ve tam sayı koordinatlı; kalabalık alanda da çakışma yok", () => {
    expect(layoutLiveMap({ ...map, people: [...map.people].reverse(), areas: [...map.areas].reverse() })).toEqual(L);
    for (const p of [...L.areas, ...L.people]) expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    const many: LiveMap = {
      areas: [area("a", "A", 12), area("b", "B")],
      people: Array.from({ length: 12 }, (_, i) => person(`p${i}`, `K${String(i).padStart(2, "0")}`)),
      links: Array.from({ length: 12 }, (_, i) => link(`p${i}`, "a")),
      generatedAt: "",
    };
    const M = layoutLiveMap(many);
    expect(layoutHasOverlap(M)).toBe(false);
    for (const l of M.links) expect(linkCrossesForeignHex(M, l)).toBe(false);
  });
});
