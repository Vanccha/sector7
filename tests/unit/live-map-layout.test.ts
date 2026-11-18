import { describe, expect, it } from "vitest";
import type { LiveMap } from "../../src/lib/contracts/live-map";
import { layoutHasOverlap, layoutLiveMap, NODE_BOX } from "../../src/lib/live-map-layout";

const SIZE = { width: 1000, height: 700 };
const pad = (n: number, w = 3) => String(n).padStart(w, "0");
const HEX_H = NODE_BOX.area.t + NODE_BOX.area.b;
type Pt = { id: string; x: number; y: number };
type Layout = ReturnType<typeof layoutLiveMap>;

function areaOf(i: number, activeCount = 1) {
  return { id: `a${pad(i)}`, name: `Alan ${pad(i)}`, archived: false, activeCount, managerName: i % 2 ? "Yönetici" : null };
}
function personOf(j: number) {
  return { id: `p${pad(j)}`, name: `Kişi ${pad(j)}`, homeAreaId: null };
}
function link(userId: string, areaId: string, k: string) {
  return { ticketId: `t-${userId}-${k}`, title: "T", areaId, userId, status: "taken" as const, takenAt: null, paused: false };
}
/** Kişi j, alan (j+k mod n) alanlarına bağlı. */
function makeMap(n: number, m: number, linksPer = 1): LiveMap {
  const areas = Array.from({ length: n }, (_, i) => areaOf(i));
  const people = Array.from({ length: m }, (_, j) => personOf(j));
  const links = [];
  if (n > 0)
    for (let j = 0; j < m; j++)
      for (let k = 0; k < Math.min(linksPer, n); k++) links.push(link(people[j]!.id, areas[(j + k) % n]!.id, String(k)));
  return { areas, people, links, generatedAt: "2026-11-18T09:00:00.000Z" };
}

const centroid = (pts: Pt[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});
const isCenter = (p: Pt, c: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y) < 2;
const byId = (pts: Pt[]) => [...pts].sort((x, y) => (x.id < y.id ? -1 : 1));

function boxOf(p: Pt, b: { l: number; r: number; t: number; b: number }) {
  return { x0: p.x - b.l, x1: p.x + b.r, y0: p.y - b.t, y1: p.y + b.b };
}
const boxHit = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Bağımsız çakışma kontrolü: bulunan ilk sorunun açıklaması ya da null. */
function findOverlap(l: Layout): string | null {
  for (let i = 0; i < l.areas.length; i++)
    for (let j = i + 1; j < l.areas.length; j++) {
      const d = Math.hypot(l.areas[i]!.x - l.areas[j]!.x, l.areas[i]!.y - l.areas[j]!.y);
      if (d < HEX_H - 1.5) return `alan ${l.areas[i]!.id}/${l.areas[j]!.id} merkez uzaklığı ${d}`;
    }
  const pb = l.people.map((p) => ({ id: p.id, b: boxOf(p, NODE_BOX.person) }));
  for (const p of pb) for (const a of l.areas) if (boxHit(p.b, boxOf(a, NODE_BOX.area))) return `kişi ${p.id} alan ${a.id} ile kesişiyor`;
  for (let i = 0; i < pb.length; i++)
    for (let j = i + 1; j < pb.length; j++) if (boxHit(pb[i]!.b, pb[j]!.b)) return `kişi ${pb[i]!.id}/${pb[j]!.id} kesişiyor`;
  return null;
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

type Seg = { a: Pt; b: Pt; person: string; area: string };
const orient = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
const onSeg = (p: Pt, q: Pt, r: Pt) =>
  Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
function segmentsIntersect(s: Seg, t: Seg) {
  const d1 = orient(t.a, t.b, s.a);
  const d2 = orient(t.a, t.b, s.b);
  const d3 = orient(s.a, s.b, t.a);
  const d4 = orient(s.a, s.b, t.b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSeg(t.a, t.b, s.a)) return true;
  if (d2 === 0 && onSeg(t.a, t.b, s.b)) return true;
  if (d3 === 0 && onSeg(s.a, s.b, t.a)) return true;
  if (d4 === 0 && onSeg(s.a, s.b, t.b)) return true;
  return false;
}

const COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 18, 19, 24, 30];

describe("layoutLiveMap: determinizm ve tam sayı", () => {
  it("aynı girdi (ve karıştırılmış girdi sırası) aynı sonucu verir", () => {
    const map = makeMap(7, 9, 2);
    const a = layoutLiveMap(map, SIZE);
    expect(layoutLiveMap(map, SIZE)).toEqual(a);
    const shuffled: LiveMap = {
      ...map,
      areas: [...map.areas].reverse(),
      people: [...map.people].reverse(),
      links: [...map.links].reverse(),
    };
    const b = layoutLiveMap(shuffled, SIZE);
    expect(byId(b.areas)).toEqual(byId(a.areas));
    expect(byId(b.people)).toEqual(byId(a.people));
    expect([b.width, b.height]).toEqual([a.width, a.height]);
  });

  it("tüm koordinatlar ve boyutlar tam sayı; her düğüm için bir nokta", () => {
    for (const [n, m] of [[0, 0], [1, 0], [0, 4], [7, 7], [13, 30], [30, 30]] as const) {
      const l = layoutLiveMap(makeMap(n, m, 2), SIZE);
      expect(l.areas).toHaveLength(n);
      expect(l.people).toHaveLength(m);
      for (const p of [...l.areas, ...l.people]) {
        expect(Number.isInteger(p.x), `${p.id}.x`).toBe(true);
        expect(Number.isInteger(p.y), `${p.id}.y`).toBe(true);
      }
      expect(Number.isInteger(l.width) && Number.isInteger(l.height)).toBe(true);
      expect(l.width).toBeGreaterThan(0);
      expect(l.height).toBeGreaterThan(0);
    }
  });

  it("tüm düğüm kutuları dönen width/height içinde kalır", () => {
    const l = layoutLiveMap(makeMap(7, 30, 2), SIZE);
    const bs = [...l.areas.map((a) => boxOf(a, NODE_BOX.area)), ...l.people.map((p) => boxOf(p, NODE_BOX.person))];
    expect(Math.min(...bs.map((b) => b.x0))).toBeGreaterThanOrEqual(-1);
    expect(Math.min(...bs.map((b) => b.y0))).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...bs.map((b) => b.x1))).toBeLessThanOrEqual(l.width + 1);
    expect(Math.max(...bs.map((b) => b.y1))).toBeLessThanOrEqual(l.height + 1);
  });
});

describe("layoutLiveMap: çakışmazlık", () => {
  for (const n of COUNTS)
    for (const m of COUNTS)
      it(`${n} alan x ${m} kişi (1 ve 2 bağlantı): çakışma yok`, () => {
        for (const linksPer of [1, 2]) {
          const l = layoutLiveMap(makeMap(n, m, linksPer), SIZE);
          expect(layoutHasOverlap(l)).toBe(false);
          expect(findOverlap(l)).toBeNull();
        }
      });

  it("0-30 alan x 0-30 kişi tam tarama: çakışma yok", () => {
    for (let n = 0; n <= 30; n += 1)
      for (let m = 0; m <= 30; m += 5) {
        const l = layoutLiveMap(makeMap(n, m, 2), SIZE);
        expect(layoutHasOverlap(l), `${n}x${m}`).toBe(false);
        expect(findOverlap(l), `${n}x${m}`).toBeNull();
      }
  });
});

describe("layoutLiveMap: simetri", () => {
  it("n=1: tek alan orijinde (tuval ortasında)", () => {
    const l = layoutLiveMap(makeMap(1, 0), SIZE);
    expect(l.areas).toHaveLength(1);
    expect(Math.abs(l.areas[0]!.x - l.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(l.areas[0]!.y - l.height / 2)).toBeLessThanOrEqual(1);
  });

  it("n=7: bir alan merkezde, 6 alan eşit uzaklıkta", () => {
    for (const m of [0, 5]) {
      const l = layoutLiveMap(makeMap(7, m), SIZE);
      const c = centroid(l.areas);
      const ds = l.areas.map((a) => Math.hypot(a.x - c.x, a.y - c.y)).sort((x, y) => x - y);
      expect(ds[0]!).toBeLessThanOrEqual(2);
      const ring = ds.slice(1);
      expect(Math.max(...ring) - Math.min(...ring)).toBeLessThanOrEqual(2);
      expect(ring[0]!).toBeGreaterThanOrEqual(HEX_H - 1.5);
    }
  });

  it("alan merkezlerinin ortalaması yatayda tuval ortasında, n=1..30", () => {
    for (let n = 1; n <= 30; n++)
      for (const m of [0, 6]) {
        const l = layoutLiveMap(makeMap(n, m), SIZE);
        const c = centroid(l.areas);
        expect(Math.abs(c.x - l.width / 2), `n=${n} m=${m}`).toBeLessThanOrEqual(2);
      }
  });

  it("komşu alan merkezleri aralığı sabit (n=7 ve n=19 en yakın komşu uzaklığı)", () => {
    for (const n of [7, 19]) {
      const l = layoutLiveMap(makeMap(n, 0), SIZE);
      const nearest = l.areas.map((a) =>
        Math.min(...l.areas.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
      );
      expect(Math.max(...nearest) - Math.min(...nearest)).toBeLessThanOrEqual(2);
    }
  });
});

describe("layoutLiveMap: dıştan içe doldurma (activeCount)", () => {
  // activeCount>0 alanlar dış katmanda, boşlar iç/merkezde; ad sırası atamayı belirlemez.
  const cases: [number, number[]][] = [
    [7, [0, 2, 5]],
    [7, [1, 2, 3, 4, 5, 6]],
    [7, [6]],
    [19, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    [13, [12, 11, 10, 9, 8, 7]],
  ];
  for (const [n, active] of cases)
    it(`${n} alan, aktif ${JSON.stringify(active)}: aktifler merkezde değil, boşlardan uzakta`, () => {
      const areas = Array.from({ length: n }, (_, i) => areaOf(i, active.includes(i) ? 2 : 0));
      const l = layoutLiveMap({ areas, people: [], links: [], generatedAt: "2026-11-18T09:00:00.000Z" }, SIZE);
      const c = centroid(l.areas);
      const r = (id: string) => {
        const a = l.areas.find((x) => x.id === id)!;
        return Math.hypot(a.x - c.x, a.y - c.y);
      };
      const act = areas.filter((a) => a.activeCount > 0).map((a) => r(a.id));
      const idle = areas.filter((a) => a.activeCount === 0).map((a) => r(a.id));
      for (const x of act) expect(x).toBeGreaterThan(2); // merkezde değil
      if (idle.length) expect(Math.min(...act)).toBeGreaterThanOrEqual(Math.max(...idle) - 2);
    });

  it("activeCount büyük olan alan küçük olandan içte değildir (azalan sıra)", () => {
    const areas = Array.from({ length: 7 }, (_, i) => areaOf(i, i === 3 ? 0 : 1 + i));
    const l = layoutLiveMap({ areas, people: [], links: [], generatedAt: "2026-11-18T09:00:00.000Z" }, SIZE);
    const c = centroid(l.areas);
    const idle = l.areas.find((a) => a.id === "a003")!;
    expect(Math.hypot(idle.x - c.x, idle.y - c.y)).toBeLessThanOrEqual(2);
  });
});

describe("layoutLiveMap: aynı kişinin alanları yan yana", () => {
  it("7 alan (biri boş -> merkez, 6 aktif dış halkada): A+C ve B+D komşu hücrelerde", () => {
    const areas = [...Array.from({ length: 6 }, (_, i) => areaOf(i)), areaOf(6, 0)];
    const people = [personOf(0), personOf(1)];
    const [A, B, C, D] = areas;
    const links = [link("p000", A!.id, "a"), link("p000", C!.id, "c"), link("p001", B!.id, "b"), link("p001", D!.id, "d")];
    const l = layoutLiveMap({ areas, people, links, generatedAt: "2026-11-18T09:00:00.000Z" }, SIZE);
    const pos = new Map(l.areas.map((a) => [a.id, a]));
    const c = centroid(l.areas);
    expect(isCenter(pos.get("a006")!, c)).toBe(true);
    const dist = (x: string, y: string) => Math.hypot(pos.get(x)!.x - pos.get(y)!.x, pos.get(x)!.y - pos.get(y)!.y);
    let minPair = Infinity;
    for (const a of l.areas) for (const b of l.areas) if (a !== b) minPair = Math.min(minPair, Math.hypot(a.x - b.x, a.y - b.y));
    expect(dist(A!.id, C!.id)).toBeLessThanOrEqual(minPair + 2);
    expect(dist(B!.id, D!.id)).toBeLessThanOrEqual(minPair + 2);
  });
});

describe("layoutLiveMap: dış halka", () => {
  const cases: [number, number][] = [[1, 1], [2, 3], [3, 5], [7, 7], [7, 30], [13, 12], [19, 30], [30, 30]];
  for (const [n, m] of cases)
    it(`${n} alan x ${m} kişi: kişiler küme merkezinden eşit uzaklıkta ve her alandan dışta`, () => {
      const l = layoutLiveMap(makeMap(n, m, 2), SIZE);
      const c = centroid(l.areas);
      const rs = l.people.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
      expect(Math.max(...rs) - Math.min(...rs)).toBeLessThanOrEqual(3);
      const outer = Math.max(...l.areas.map((a) => Math.hypot(a.x - c.x, a.y - c.y)));
      expect(Math.min(...rs)).toBeGreaterThan(outer);
    });

  it("kişi sayısı arttıkça halka büyür: 30 kişi > 3 kişi", () => {
    for (const n of [1, 4, 7]) {
      const radius = (m: number) => {
        const l = layoutLiveMap(makeMap(n, m), SIZE);
        const c = centroid(l.areas);
        return Math.hypot(l.people[0]!.x - c.x, l.people[0]!.y - c.y);
      };
      expect(radius(30), `n=${n}`).toBeGreaterThan(radius(3));
    }
  });
});

describe("layoutLiveMap: çok alanlı kişi açısı", () => {
  it("komşu olmayan iki alana bağlı tek kişi, iki alanın dairesel ortasında durur", () => {
    const map = makeMap(7, 0);
    map.people.push(personOf(0));
    const l0 = layoutLiveMap(map, SIZE);
    const c = centroid(l0.areas);
    const ring = l0.areas.filter((a) => !isCenter(a, c));
    const ang = (p: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
    // Dış halkadaki iki alanı seç: açıları ~120° ve ~180° farklı (komşu değil).
    for (const [i, j] of [[0, 2], [1, 3], [0, 3]] as const) {
      const A = ring[i]!;
      const B = ring[j]!;
      const m2: LiveMap = { ...map, links: [link("p000", A.id, "x"), link("p000", B.id, "y")] };
      const l = layoutLiveMap(m2, SIZE);
      const cc = centroid(l.areas);
      const a = l.areas.find((x) => x.id === A.id)!;
      const b = l.areas.find((x) => x.id === B.id)!;
      const expected = Math.atan2(Math.sin(ang0(a, cc)) + Math.sin(ang0(b, cc)), Math.cos(ang0(a, cc)) + Math.cos(ang0(b, cc)));
      const p = l.people[0]!;
      const got = Math.atan2(p.y - cc.y, p.x - cc.x);
      let d = Math.abs(got - expected) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      const sep = Math.abs(Math.atan2(Math.sin(ang0(a, cc) - ang0(b, cc)), Math.cos(ang0(a, cc) - ang0(b, cc))));
      if (sep > Math.PI - 0.05) continue; // zıt alanlar: ortalama tanımsız
      expect(d * (180 / Math.PI), `${i},${j}`).toBeLessThanOrEqual(4);
    }
    void ang;
  });

  it("tek alana bağlı kişi o alanla aynı açıda durur (merkez dışı alan)", () => {
    const map = makeMap(7, 0);
    map.people.push(personOf(0));
    const l0 = layoutLiveMap(map, SIZE);
    const c = centroid(l0.areas);
    const target = l0.areas.find((a) => !isCenter(a, c))!;
    const l = layoutLiveMap({ ...map, links: [link("p000", target.id, "x")] }, SIZE);
    const cc = centroid(l.areas);
    const a = l.areas.find((x) => x.id === target.id)!;
    const p = l.people[0]!;
    let d = Math.abs(ang0(p, cc) - ang0(a, cc)) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    expect(d * (180 / Math.PI)).toBeLessThanOrEqual(3);
  });
});
function ang0(p: { x: number; y: number }, c: { x: number; y: number }) {
  return Math.atan2(p.y - c.y, p.x - c.x);
}

describe("layoutLiveMap: kişi->alan çizgileri kesişmez (kanıtlanabilir garantiler)", () => {
  function crossings(map: LiveMap, l: Layout, onlyOuter: boolean): string[] {
    const c = centroid(l.areas);
    const rad = (a: Pt) => Math.hypot(a.x - c.x, a.y - c.y);
    const maxR = Math.max(...l.areas.map(rad));
    const A = new Map(l.areas.map((a) => [a.id, a]));
    const P = new Map(l.people.map((p) => [p.id, p]));
    const segs: Seg[] = map.links
      .filter((k) => !onlyOuter || rad(A.get(k.areaId)!) >= maxR - 2)
      .map((k) => ({ a: P.get(k.userId)!, b: A.get(k.areaId)!, person: k.userId, area: k.areaId }));
    const bad: string[] = [];
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i]!;
        const t = segs[j]!;
        if (s.person === t.person || s.area === t.area) continue;
        if (segmentsIntersect(s, t)) bad.push(`${s.person}->${s.area} x ${t.person}->${t.area}`);
      }
    return bad;
  }

  /** Yalnız tek bağlantılı kişiler. */
  function singleLinkScenario(seed: number): LiveMap {
    const rnd = mulberry32(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const n = int(3, 12);
    const m = int(2, 20);
    const areas = Array.from({ length: n }, (_, i) => areaOf(i));
    const people = Array.from({ length: m }, (_, j) => personOf(j));
    const links = people.map((p) => link(p.id, areas[int(0, n - 1)]!.id, "s"));
    return { areas, people, links, generatedAt: "2026-11-18T09:00:00.000Z" };
  }

  for (let seed = 1; seed <= 50; seed++)
    it(`tek bağlantılı kişiler, senaryo #${seed}: dış katman alanlarına giden çizgiler kesişmez`, () => {
      const map = singleLinkScenario(seed);
      const l = layoutLiveMap(map, SIZE);
      expect(crossings(map, l, true), `seed=${seed} alan=${map.areas.length} kişi=${map.people.length}`).toEqual([]);
    });

  it("2 kişi, karşılıklı alan çiftleri (<=7 alan, hepsi aktif): kesişme 0", () => {
    for (let n = 4; n <= 7; n++)
      for (const [p0, p1] of [[[0, 2], [1, 3]], [[0, 1], [2, 3]], [[0, 3], [1, 2]], [[0, 2], [1, n - 1]]] as const) {
        if (new Set([...p0, ...p1]).size < 4) continue;
        const areas = Array.from({ length: n }, (_, i) => areaOf(i));
        const people = [personOf(0), personOf(1)];
        const links = [
          ...p0.map((i) => link("p000", areas[i]!.id, String(i))),
          ...p1.map((i) => link("p001", areas[i]!.id, String(i))),
        ];
        const map: LiveMap = { areas, people, links, generatedAt: "2026-11-18T09:00:00.000Z" };
        const l = layoutLiveMap(map, SIZE);
        expect(crossings(map, l, false), `n=${n} p0=${p0} p1=${p1}`).toEqual([]);
      }
  });
});
