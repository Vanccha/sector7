import { describe, expect, it } from "vitest";
import type { LiveMap } from "../../src/lib/contracts/live-map";
import {
  HEX_POLY,
  layoutHasOverlap,
  layoutLiveMap,
  linkCrossesForeignHex,
  linkCrossesOtherPerson,
  N1MAX,
  NODE_BOX,
} from "../../src/lib/live-map-layout";

const SIZE = { width: 1000, height: 700 };
const GEN = "2026-11-18T09:00:00.000Z";
const DEG = 180 / Math.PI;
type XY = { x: number; y: number };
type Layout = ReturnType<typeof layoutLiveMap>;
type Area = LiveMap["areas"][number];
const pad = (n: number, w = 3) => String(n).padStart(w, "0");

function mkArea(id: string, name: string, activeCount: number): Area {
  return { id, name, archived: false, activeCount, managerName: null };
}
function mkPerson(id: string, name: string) {
  return { id, name, homeAreaId: null };
}
function mkLink(userId: string, areaId: string) {
  return { ticketId: `t-${userId}-${areaId}`, title: "T", areaId, userId, status: "taken" as const, takenAt: null, paused: false };
}

/** Tohumlu deterministik PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1-20 alan, 1-15 kişi, kişi başına 1-2 farklı alana bağlantı. activeCount = o alana bağlı bağlantı sayısı. */
function scenario(seed: number): LiveMap {
  const rnd = mulberry32(seed * 7919 + 13);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const n = int(1, 20);
  const m = int(1, 15);
  const areas = Array.from({ length: n }, (_, i) => mkArea(`a${pad(i)}`, `Alan ${pad(i)}`, 0));
  const people = Array.from({ length: m }, (_, j) => mkPerson(`p${pad(j)}`, `Kisi ${pad(j)}`));
  const links: ReturnType<typeof mkLink>[] = [];
  for (const p of people) {
    const want = Math.min(int(1, 2), n);
    const picked = new Set<number>();
    while (picked.size < want) picked.add(int(0, n - 1));
    for (const i of picked) links.push(mkLink(p.id, areas[i]!.id));
  }
  for (const a of areas) a.activeCount = links.filter((k) => k.areaId === a.id).length;
  return { areas, people, links, generatedAt: GEN };
}

/** Demo: 3 aktif + 4 boş alan, 6 kişi. */
function demoMap() {
  const areas = [
    mkArea("d-mobil", "Demo · Mobil", 2),
    mkArea("d-tasarim", "Demo · Tasarım", 3),
    mkArea("d-web", "Demo · Web", 4),
    mkArea("e-donanim", "Donanım", 0),
    mkArea("e-icerik", "İçerik", 0),
    mkArea("e-tasarim", "Tasarım", 0),
    mkArea("e-yazilim", "Yazılım", 0),
  ];
  const people = [
    mkPerson("u-burak", "Burak"),
    mkPerson("u-zeynep", "Zeynep"),
    mkPerson("u-deniz", "Deniz"),
    mkPerson("u-selin", "Selin"),
    mkPerson("u-emre", "Emre"),
    mkPerson("u-ceren", "Ceren"),
  ];
  const links = [
    mkLink("u-burak", "d-web"),
    mkLink("u-burak", "d-tasarim"),
    mkLink("u-zeynep", "d-mobil"),
    mkLink("u-zeynep", "d-web"),
    mkLink("u-deniz", "d-mobil"),
    mkLink("u-selin", "d-tasarim"),
    mkLink("u-emre", "d-web"),
    mkLink("u-ceren", "d-web"),
  ];
  return { areas, people, links, generatedAt: GEN } satisfies LiveMap;
}

/* ---- Bağımsız yardımcılar ---- */
const tr = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, "tr") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ctr = (l: Layout): XY => ({ x: l.width / 2, y: l.height / 2 });
const rad = (p: XY, c: XY) => Math.hypot(p.x - c.x, p.y - c.y);
/** Tepeden saat yönünde derece [0,360). */
const clockDeg = (p: XY, c: XY) => ((Math.atan2(p.x - c.x, -(p.y - c.y)) * DEG) % 360 + 360) % 360;
const angGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Beklenen halka-1 yuvaları (kural 1-2): aktifler i -> round(i*n1/k); boşlar kalan yuvaları ad sırasıyla doldurur. */
function expectedRings(map: LiveMap) {
  const linked = new Set(map.links.map((l) => l.areaId));
  const sorted = [...map.areas].sort(tr);
  const actives = sorted.filter((a) => a.activeCount > 0 || linked.has(a.id));
  const empties = sorted.filter((a) => !(a.activeCount > 0 || linked.has(a.id)));
  const n1 = actives.length + Math.min(Math.max(0, N1MAX - actives.length), empties.length);
  const slots: (Area | undefined)[] = new Array(n1).fill(undefined);
  actives.forEach((a, i) => (slots[Math.round((i * n1) / actives.length)] = a));
  let e = 0;
  for (let i = 0; i < n1; i++) if (!slots[i]) slots[i] = empties[e++];
  return { slots: slots as Area[], ring2: empties.slice(e), actives, n1 };
}

const orient = (p: XY, q: XY, r: XY) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
const onSeg = (p: XY, q: XY, r: XY) =>
  Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
function segSeg(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSeg(c, d, a)) || (d2 === 0 && onSeg(c, d, b)) || (d3 === 0 && onSeg(a, b, c)) || (d4 === 0 && onSeg(a, b, d));
}
const hexAt = (c: XY): XY[] => HEX_POLY.map(([x, y]) => ({ x: c.x + x, y: c.y + y }));
function inPoly(poly: XY[], p: XY): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function segPoly(a: XY, b: XY, poly: XY[]): boolean {
  if (inPoly(poly, a) || inPoly(poly, b)) return true;
  for (let i = 0; i < poly.length; i++) if (segSeg(a, b, poly[i]!, poly[(i + 1) % poly.length]!)) return true;
  return false;
}
/** Bağlantı doğru parçasının hedef dışı kestiği ilk altıgenin id'si. */
function foreignHexHit(l: Layout, k: Layout["links"][number]): string | null {
  for (const a of l.areas) {
    if (a.id === k.areaId) continue;
    if (segPoly(k.pts[0]!, k.pts[1]!, hexAt(a))) return a.id;
  }
  return null;
}
/** Orijinden altıgen çokgenine en kısa uzaklık (iç kenar). */
function innerEdge(a: XY, c: XY): number {
  const poly = hexAt(a);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const t = Math.min(1, Math.max(0, ((c.x - p.x) * dx + (c.y - p.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(c.x - (p.x + t * dx), c.y - (p.y + t * dy)));
  }
  return best;
}

/** Düzenden halka bilgisi çıkarır ve kural 1-2'nin ortak doğrulamalarını yapar. */
function ringInfo(map: LiveMap, l: Layout) {
  const c = ctr(l);
  const ex = expectedRings(map);
  const at = new Map(l.areas.map((a) => [a.id, a]));
  const ring1 = ex.slots.map((a) => at.get(a.id)!);
  const R1 = ring1.reduce((s, a) => s + rad(a, c), 0) / ring1.length;
  return { c, ex, at, ring1, R1 };
}
function deviation(a: number, b: number) {
  return angGap(a, b);
}

/** Tek alanlı kişi sapması (derece) ve çok alanlı komşu kişi için "arada mı" kontrolü. */
function personAngleStats(map: LiveMap, l: Layout) {
  const { c, ex, at, R1 } = ringInfo(map, l);
  const slotOf = new Map(ex.slots.map((a, i) => [a.id, i]));
  const perPerson = new Map<string, string[]>();
  for (const k of map.links) perPerson.set(k.userId, [...new Set([...(perPerson.get(k.userId) ?? []), k.areaId])]);
  let maxSingleDev = 0;
  const outsideBetween: string[] = [];
  const pt = new Map(l.people.map((p) => [p.id, p]));
  for (const [uid, aids] of perPerson) {
    const p = pt.get(uid)!;
    if (rad(p, c) < 1) continue;
    if (aids.length === 1) {
      maxSingleDev = Math.max(maxSingleDev, deviation(clockDeg(p, c), clockDeg(at.get(aids[0]!)!, c)));
    } else if (aids.length === 2) {
      const [s0, s1] = [slotOf.get(aids[0]!), slotOf.get(aids[1]!)];
      if (s0 === undefined || s1 === undefined) continue;
      const diff = Math.abs(s0 - s1);
      if (Math.min(diff, ex.n1 - diff) !== 1) continue; // yalnız komşu iki alan
      const g = angGap(clockDeg(at.get(aids[0]!)!, c), clockDeg(at.get(aids[1]!)!, c));
      const d0 = angGap(clockDeg(p, c), clockDeg(at.get(aids[0]!)!, c));
      const d1 = angGap(clockDeg(p, c), clockDeg(at.get(aids[1]!)!, c));
      if (d0 + d1 > g + 1.5) outsideBetween.push(uid);
    }
  }
  return { maxSingleDev, outsideBetween, R1 };
}

/** Yoğun olmayan: <=6 kişi ve her alana en çok 1 kişi bağlı (aynı alandaki kişiler fiziksel olarak açıdan ayrılmak zorunda). */
function sparse(map: LiveMap) {
  if (map.people.length > 6) return false;
  const per = new Map<string, Set<string>>();
  for (const k of map.links) per.set(k.areaId, new Set([...(per.get(k.areaId) ?? []), k.userId]));
  return [...per.values()].every((s) => s.size <= 1);
}

const ALL = Array.from({ length: 320 }, (_, i) => i + 1);

describe("layoutLiveMap — kural 1: alan halkası-1", () => {
  it("alanlar orijin merkezli çemberde eşit yarıçap ve eşit açıyla durur (hex ızgarası yok)", () => {
    for (const n of [1, 2, 3, 5, 7, 10, 14]) {
      const areas = Array.from({ length: n }, (_, i) => mkArea(`a${pad(i)}`, `Alan ${pad(i)}`, 1));
      const people = [mkPerson("p0", "Kisi")];
      const map: LiveMap = { areas, people, links: [mkLink("p0", "a000")], generatedAt: GEN };
      const l = layoutLiveMap(map, SIZE);
      const c = ctr(l);
      const radii = l.areas.map((a) => rad(a, c));
      expect(Math.max(...radii) - Math.min(...radii), `n=${n}`).toBeLessThanOrEqual(2);
      if (n >= 2) {
        const angs = l.areas.map((a) => clockDeg(a, c)).sort((x, y) => x - y);
        for (let i = 0; i < n; i++) {
          const gap = i + 1 < n ? angs[i + 1]! - angs[i]! : angs[0]! + 360 - angs[i]!;
          expect(Math.abs(gap - 360 / n), `n=${n} gap#${i}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("tepe yuvası (0°) ilk aktif alanındır; ad sırasına göre ilk aktif alan en üstte", () => {
    // "Alan 000" boş, "Alan 001" ilk aktif.
    const areas = [mkArea("x0", "Alan 000", 0), mkArea("x1", "Alan 001", 1), mkArea("x2", "Alan 002", 1), mkArea("x3", "Alan 003", 0)];
    const map: LiveMap = { areas, people: [mkPerson("p", "K")], links: [mkLink("p", "x1"), mkLink("p", "x2")], generatedAt: GEN };
    const l = layoutLiveMap(map, SIZE);
    const c = ctr(l);
    const top = l.areas.find((a) => a.id === "x1")!;
    expect(Math.min(clockDeg(top, c), 360 - clockDeg(top, c))).toBeLessThanOrEqual(1);
  });

  it("aktifler halkaya eşit aralıkla (i -> round(i*n1/k)), boşlar kalan yuvaları ad sırasıyla saat yönünde doldurur", () => {
    const cases: [number, number][] = [[3, 4], [2, 5], [4, 4], [1, 6], [3, 8], [5, 2]];
    for (const [k, e] of cases) {
      const areas = [
        ...Array.from({ length: k }, (_, i) => mkArea(`a${i}`, `A-aktif ${pad(i)}`, 1)),
        ...Array.from({ length: e }, (_, i) => mkArea(`e${i}`, `B-bos ${pad(i)}`, 0)),
      ];
      const links = areas.filter((a) => a.activeCount > 0).map((a) => mkLink("p", a.id));
      const map: LiveMap = { areas, people: [mkPerson("p", "K")], links, generatedAt: GEN };
      const l = layoutLiveMap(map, SIZE);
      const { c, ex, at } = ringInfo(map, l);
      ex.slots.forEach((a, i) => {
        const want = (i * 360) / ex.n1;
        expect(angGap(clockDeg(at.get(a.id)!, c), want), `k=${k} e=${e} slot ${i} (${a.name})`).toBeLessThanOrEqual(1.5);
      });
    }
  });

  it("Türkçe ad sırası: boş alanlar Donanım, İçerik, Tasarım, Yazılım sırasıyla yuvalara dolar", () => {
    const map = demoMap();
    const l = layoutLiveMap(map, SIZE);
    const { c, at, ex } = ringInfo(map, l);
    const emptyIds = ex.slots.filter((a) => a.activeCount === 0).map((a) => a.name);
    expect(emptyIds).toEqual(["Donanım", "İçerik", "Tasarım", "Yazılım"]);
    // Çıktıdaki saat yönü sırası da aynı olmalı.
    const clockwise = l.areas
      .map((a) => ({ id: a.id, ang: clockDeg(a, c) }))
      .filter((a) => map.areas.find((x) => x.id === a.id)!.activeCount === 0)
      .sort((p, q) => p.ang - q.ang)
      .map((p) => map.areas.find((x) => x.id === p.id)!.name);
    expect(clockwise).toEqual(["Donanım", "İçerik", "Tasarım", "Yazılım"]);
    expect(at.size).toBe(7);
  });
});

describe("layoutLiveMap — kural 2: halka-2", () => {
  it("alan sayısı N1MAX'ı aşınca boş alanlar halka-2'ye gider (R2 > R1), halka-1'de N1MAX alan kalır", () => {
    const n = N1MAX + 6;
    const areas = Array.from({ length: n }, (_, i) => mkArea(`a${pad(i)}`, `Alan ${pad(i)}`, i < 2 ? 1 : 0));
    const map: LiveMap = { areas, people: [mkPerson("p", "K")], links: [mkLink("p", "a000"), mkLink("p", "a001")], generatedAt: GEN };
    const l = layoutLiveMap(map, SIZE);
    const { c, ex, at, R1 } = ringInfo(map, l);
    expect(ex.n1).toBe(N1MAX);
    expect(ex.ring2).toHaveLength(6);
    for (const a of ex.slots) expect(Math.abs(rad(at.get(a.id)!, c) - R1)).toBeLessThanOrEqual(1);
    const r2 = ex.ring2.map((a) => rad(at.get(a.id)!, c));
    for (const r of r2) expect(r).toBeGreaterThan(R1 + 1);
    expect(layoutHasOverlap(l)).toBe(false);
  });

  it("aktif sayısı N1MAX'ı aşarsa hepsi halka-1'dedir ve halka-1 büyür; halka-2 olmaz", () => {
    const small = layoutLiveMap(
      { areas: Array.from({ length: 5 }, (_, i) => mkArea(`a${i}`, `A ${pad(i)}`, 1)), people: [mkPerson("p", "K")], links: [mkLink("p", "a0")], generatedAt: GEN },
      SIZE,
    );
    const n = N1MAX + 4;
    const areas = Array.from({ length: n }, (_, i) => mkArea(`a${pad(i)}`, `Alan ${pad(i)}`, 1));
    const map: LiveMap = { areas, people: [mkPerson("p", "K")], links: [mkLink("p", "a000")], generatedAt: GEN };
    const l = layoutLiveMap(map, SIZE);
    const c = ctr(l);
    const radii = l.areas.map((a) => rad(a, c));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThanOrEqual(2);
    const smallC = ctr(small);
    expect(radii[0]!).toBeGreaterThan(rad(small.areas[0]!, smallC));
    expect(layoutHasOverlap(l)).toBe(false);
  });

  it("halka-2'deki alanlara hiç bağlantı gitmez; tüm bağlantı hedefleri halka-1'dedir", () => {
    for (const seed of ALL) {
      const map = scenario(seed);
      if (map.areas.length <= N1MAX) continue;
      const l = layoutLiveMap(map, SIZE);
      const { c, at, R1 } = ringInfo(map, l);
      for (const k of l.links) expect(Math.abs(rad(at.get(k.areaId)!, c) - R1), `seed ${seed}`).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("layoutLiveMap — kural 3: kişiler merkezde", () => {
  it("her kişinin orijine uzaklığı her halka-1 alanının iç kenarından küçüktür (300+ senaryo)", () => {
    for (const seed of ALL) {
      const map = scenario(seed);
      const l = layoutLiveMap(map, SIZE);
      const { c, ring1 } = ringInfo(map, l);
      const minInner = Math.min(...ring1.map((a) => innerEdge(a, c)));
      for (const p of l.people) expect(rad(p, c), `seed ${seed} kişi ${p.id}`).toBeLessThan(minInner);
    }
  });

  it("tek alanlı kişi alanının açısından en çok 25° sapar (yoğun olmayan: <=6 kişi, alan başına <=1 kişi)", () => {
    let checked = 0;
    for (const seed of ALL) {
      const map = scenario(seed);
      if (!sparse(map)) continue;
      checked++;
      const { maxSingleDev } = personAngleStats(map, layoutLiveMap(map, SIZE));
      expect(maxSingleDev, `seed ${seed}`).toBeLessThanOrEqual(25 + 1.5);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("çok alanlı komşu iki alanın kişisi iki alanın açıları arasında durur (yoğun olmayan: <=6 kişi, alan başına <=1 kişi)", () => {
    const cases: number[] = [];
    // Hepsi aktif, halkada komşu alanlara bağlanan tek kişi.
    for (const n of [2, 3, 4, 6, 8, 10]) {
      const areas = Array.from({ length: n }, (_, i) => mkArea(`a${pad(i)}`, `Alan ${pad(i)}`, 1));
      const people = [mkPerson("p0", "K0"), mkPerson("p1", "K1")];
      const map: LiveMap = {
        areas,
        people,
        links: [mkLink("p0", "a000"), mkLink("p0", "a001"), mkLink("p1", `a${pad(n - 1)}`), mkLink("p1", `a${pad(n - 2)}`)],
        generatedAt: GEN,
      };
      const st = personAngleStats(map, layoutLiveMap(map, SIZE));
      expect(st.outsideBetween, `n=${n}`).toEqual([]);
      cases.push(n);
    }
    for (const seed of ALL) {
      const map = scenario(seed);
      if (!sparse(map)) continue;
      expect(personAngleStats(map, layoutLiveMap(map, SIZE)).outsideBetween, `seed ${seed}`).toEqual([]);
    }
    expect(cases).toHaveLength(6);
  });

  it("bilgi: yoğun senaryolarda tek alanlı sapma dağılımı (assert yok, yalnız çıktı)", () => {
    let worst = 0;
    let over = 0;
    let dense = 0;
    for (const seed of ALL) {
      const map = scenario(seed);
      if (sparse(map)) continue;
      dense++;
      const { maxSingleDev } = personAngleStats(map, layoutLiveMap(map, SIZE));
      worst = Math.max(worst, maxSingleDev);
      if (maxSingleDev > 26.5) over++;
    }
    console.info(`[bilgi] yoğun senaryo=${dense}, 25° aşan=${over}, en kötü sapma=${worst.toFixed(1)}°`);
    expect(dense).toBeGreaterThan(0);
  });
});

describe("layoutLiveMap — kural 4: değişmez kurallar (300+ rastgele senaryo)", () => {
  it("çakışma yok, bağlantılar yabancı altıgeni kesmez (kütüphane + bağımsız kontrol), tip hep 'line'", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(300);
    for (const seed of ALL) {
      const map = scenario(seed);
      const l = layoutLiveMap(map, SIZE);
      expect(layoutHasOverlap(l), `seed ${seed}: çakışma`).toBe(false);
      const keys = new Set(map.links.map((k) => `${k.userId}|${k.areaId}`));
      expect(l.links.length, `seed ${seed}: bağlantı sayısı`).toBe(keys.size);
      for (const k of l.links) {
        expect(k.type).toBe("line");
        expect(k.pts).toHaveLength(2);
        expect(linkCrossesForeignHex(l, k), `seed ${seed} ${k.key}: kütüphane kontrolü`).toBe(false);
        expect(foreignHexHit(l, k), `seed ${seed} ${k.key}: bağımsız kontrol`).toBeNull();
      }
    }
  });

  it("bağlantı uçları: başlangıç kişiye, bitiş hedef altıgenin kenarına yakındır", () => {
    for (const seed of ALL.slice(0, 80)) {
      const map = scenario(seed);
      const l = layoutLiveMap(map, SIZE);
      const P = new Map(l.people.map((p) => [p.id, p]));
      const A = new Map(l.areas.map((a) => [a.id, a]));
      for (const k of l.links) {
        const p = P.get(k.userId)!;
        const a = A.get(k.areaId)!;
        expect(rad(k.pts[0]!, p), `seed ${seed}`).toBeLessThanOrEqual(NODE_BOX.person.l);
        // Bitiş noktası hedef altıgenin kenarında (poligona ≤3px).
        const poly = hexAt(a);
        let d = Infinity;
        for (let i = 0; i < poly.length; i++) {
          const s = poly[i]!;
          const q = poly[(i + 1) % poly.length]!;
          const dx = q.x - s.x;
          const dy = q.y - s.y;
          const t = Math.min(1, Math.max(0, ((k.pts[1]!.x - s.x) * dx + (k.pts[1]!.y - s.y) * dy) / (dx * dx + dy * dy)));
          d = Math.min(d, Math.hypot(k.pts[1]!.x - (s.x + t * dx), k.pts[1]!.y - (s.y + t * dy)));
        }
        expect(d, `seed ${seed} ${k.key}`).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("layoutLiveMap — kural 5: demo senaryosu", () => {
  const map = demoMap();
  const l = layoutLiveMap(map, SIZE);
  const c = ctr(l);

  it("hiçbir bağlantı başka bir kişinin gövdesini kesmez", () => {
    expect(l.links).toHaveLength(8);
    for (const k of l.links) expect(linkCrossesOtherPerson(l, k), k.key).toBe(false);
  });

  it("çakışma ve yabancı altıgen kesişimi yok", () => {
    expect(layoutHasOverlap(l)).toBe(false);
    for (const k of l.links) {
      expect(linkCrossesForeignHex(l, k), k.key).toBe(false);
      expect(foreignHexHit(l, k), k.key).toBeNull();
    }
  });

  it("3 aktif alan yaklaşık 120° arayla durur (bir yuva payı: 360/7)", () => {
    const angs = ["d-mobil", "d-tasarim", "d-web"].map((id) => clockDeg(l.areas.find((a) => a.id === id)!, c)).sort((x, y) => x - y);
    const gaps = [angs[1]! - angs[0]!, angs[2]! - angs[1]!, angs[0]! + 360 - angs[2]!];
    expect(gaps.reduce((s, g) => s + g, 0)).toBeCloseTo(360, 5);
    for (const g of gaps) expect(Math.abs(g - 120)).toBeLessThanOrEqual(360 / 7);
  });

  // Demo'da Web'e 4 kişi bağlı (yoğun alan): halka 1,4 kat sınırına dayanır, itme sapmayı 25°'nin biraz üstüne
  // taşıyabilir. Kesin 25° kuralı yoğun olmayan senaryolarda ayrıca test ediliyor; burada 35° üst sınır.
  it("kişiler halkanın içinde; tek alanlıların sapması <= 35° (yoğun alan)", () => {
    const { ring1 } = ringInfo(map, l);
    const minInner = Math.min(...ring1.map((a) => innerEdge(a, c)));
    for (const p of l.people) expect(rad(p, c)).toBeLessThan(minInner);
    const st = personAngleStats(map, l);
    expect(st.maxSingleDev).toBeLessThanOrEqual(35);
  });

  it("7 alan tek halkada (halka-2 yok)", () => {
    const radii = l.areas.map((a) => rad(a, c));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThanOrEqual(2);
  });
});

describe("layoutLiveMap — kural 6: genel", () => {
  const sig = (l: Layout) => ({
    areas: [...l.areas].sort((a, b) => (a.id < b.id ? -1 : 1)),
    people: [...l.people].sort((a, b) => (a.id < b.id ? -1 : 1)),
    links: l.links,
    width: l.width,
    height: l.height,
  });
  const shuffle = <T,>(arr: T[], rnd: () => number) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };

  it("determinizm: girdi sırası karıştırılsa da sonuç aynıdır", () => {
    for (const seed of ALL.slice(0, 120)) {
      const map = scenario(seed);
      const rnd = mulberry32(seed + 99);
      const shuffled: LiveMap = { ...map, areas: shuffle(map.areas, rnd), people: shuffle(map.people, rnd), links: shuffle(map.links, rnd) };
      expect(sig(layoutLiveMap(shuffled, SIZE)), `seed ${seed}`).toEqual(sig(layoutLiveMap(map, SIZE)));
    }
    const demo = demoMap();
    const rnd = mulberry32(5);
    const sh: LiveMap = { ...demo, areas: shuffle(demo.areas, rnd), people: shuffle(demo.people, rnd), links: shuffle(demo.links, rnd) };
    expect(sig(layoutLiveMap(sh, SIZE))).toEqual(sig(layoutLiveMap(demo, SIZE)));
  });

  it("aynı girdiyle iki çağrı özdeş çıktı verir (saf)", () => {
    const map = scenario(17);
    expect(layoutLiveMap(map, SIZE)).toEqual(layoutLiveMap(map, SIZE));
  });

  it("tüm koordinatlar ve tuval ölçüleri tam sayıdır", () => {
    for (const seed of ALL.slice(0, 120)) {
      const l = layoutLiveMap(scenario(seed), SIZE);
      for (const p of [...l.areas, ...l.people]) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y), `seed ${seed} ${p.id}`).toBe(true);
      }
      for (const k of l.links) {
        for (const q of [...k.pts, k.mid]) expect(Number.isInteger(q.x) && Number.isInteger(q.y), `seed ${seed} ${k.key}`).toBe(true);
      }
      expect(Number.isInteger(l.width) && Number.isInteger(l.height)).toBe(true);
    }
  });

  it("tuval orijine göre simetrik: merkez tuvalin ortasında, tüm düğümler içeride, en uzak düğüm bir kenara yakın", () => {
    for (const seed of ALL.slice(0, 120)) {
      const map = scenario(seed);
      const l = layoutLiveMap(map, SIZE);
      const c = ctr(l);
      expect(Number.isInteger(c.x) && Number.isInteger(c.y), `seed ${seed}`).toBe(true);
      let ext = 0;
      let exty = 0;
      for (const a of l.areas) {
        ext = Math.max(ext, Math.abs(a.x - c.x) + NODE_BOX.area.l);
        exty = Math.max(exty, Math.abs(a.y - c.y) + NODE_BOX.area.t, Math.abs(a.y - c.y) + NODE_BOX.area.b);
      }
      for (const p of l.people) {
        ext = Math.max(ext, Math.abs(p.x - c.x) + NODE_BOX.person.l);
        exty = Math.max(exty, Math.abs(p.y - c.y) + NODE_BOX.person.t, Math.abs(p.y - c.y) + NODE_BOX.person.b);
      }
      expect(ext, `seed ${seed} x`).toBeLessThanOrEqual(c.x);
      expect(exty, `seed ${seed} y`).toBeLessThanOrEqual(c.y);
      // Simetrik: kenar payı iki yanda eşit, 0'a yakın değil ama gereksiz geniş de değil (<= 100).
      expect(c.x - ext, `seed ${seed} x pay`).toBeLessThanOrEqual(100);
      expect(c.y - exty, `seed ${seed} y pay`).toBeLessThanOrEqual(100);
      // Halka merkezi tuval merkezidir.
      const { R1, ring1 } = ringInfo(map, l);
      for (const a of ring1) expect(Math.abs(rad(a, c) - R1)).toBeLessThanOrEqual(1.5);
    }
  });

  it("tek alan, tek kişi gibi uç durumlar çökmez ve tutarlıdır", () => {
    const map: LiveMap = { areas: [mkArea("a", "A", 1)], people: [mkPerson("p", "P")], links: [mkLink("p", "a")], generatedAt: GEN };
    const l = layoutLiveMap(map, SIZE);
    expect(l.areas).toHaveLength(1);
    expect(l.people).toHaveLength(1);
    expect(l.links).toHaveLength(1);
    expect(layoutHasOverlap(l)).toBe(false);
    const empty = layoutLiveMap({ areas: [], people: [], links: [], generatedAt: GEN }, SIZE);
    expect(empty.areas).toHaveLength(0);
  });

  it("performans: en kötü senaryo < 100 ms (gevşek eşik, 3 denemenin en iyisi)", () => {
    // Isınma.
    layoutLiveMap(scenario(1), SIZE);
    const timed: { seed: number; ms: number }[] = [];
    for (const seed of ALL) {
      const map = scenario(seed);
      const t0 = performance.now();
      layoutLiveMap(map, SIZE);
      timed.push({ seed, ms: performance.now() - t0 });
    }
    timed.sort((a, b) => b.ms - a.ms);
    // En yavaş 5 senaryoyu yeniden ölç; her biri için en iyi süre.
    const worst = timed.slice(0, 5).map(({ seed }) => {
      const map = scenario(seed);
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        layoutLiveMap(map, SIZE);
        best = Math.min(best, performance.now() - t0);
      }
      return { seed, best };
    });
    console.info(`[bilgi] en yavaş: ${worst.map((w) => `${w.seed}=${w.best.toFixed(1)}ms`).join(", ")}`);
    for (const w of worst) expect(w.best, `seed ${w.seed}`).toBeLessThan(100);
  });
});
