import { describe, expect, it } from "vitest";
import type { LiveMap } from "../../src/lib/contracts/live-map";
import { layoutLiveMap, NODE_BOX } from "../../src/lib/live-map-layout";

const SIZE = { width: 1000, height: 700 };
const pad = (n: number, w = 3) => String(n).padStart(w, "0");

/** Kişi j, alan (j mod n) ve (j+1 mod n) alanlarına bağlı (n=0 ise bağsız). */
function makeMap(n: number, m: number, linksPer = 1): LiveMap {
  const areas = Array.from({ length: n }, (_, i) => ({ id: `a${pad(i)}`, name: `Alan ${i}`, archived: false, activeCount: 1 }));
  const people = Array.from({ length: m }, (_, j) => ({ id: `p${pad(j)}`, name: `Kişi ${j}`, homeAreaId: null }));
  const links = [];
  if (n > 0)
    for (let j = 0; j < m; j++)
      for (let k = 0; k < linksPer; k++)
        links.push({
          ticketId: `t${j}-${k}`, title: "T", areaId: areas[(j + k) % n]!.id, userId: people[j]!.id,
          status: "taken" as const, takenAt: null, paused: false,
        });
  return { areas, people, links, generatedAt: "2026-11-18T09:00:00.000Z" };
}

function boxes(l: ReturnType<typeof layoutLiveMap>) {
  const mk = (p: { id: string; x: number; y: number }, b: { l: number; r: number; t: number; b: number }) => ({
    id: p.id, x0: p.x - b.l, x1: p.x + b.r, y0: p.y - b.t, y1: p.y + b.b,
  });
  return [...l.areas.map((a) => mk(a, NODE_BOX.area)), ...l.people.map((p) => mk(p, NODE_BOX.person))];
}

const COUNTS = [0, 1, 2, 7, 30];

describe("layoutLiveMap", () => {
  it("deterministik: aynı girdi (ve karıştırılmış sıra) aynı sonucu verir", () => {
    const map = makeMap(7, 7, 2);
    const a = layoutLiveMap(map, SIZE);
    expect(layoutLiveMap(map, SIZE)).toEqual(a);
    const shuffled: LiveMap = { ...map, areas: [...map.areas].reverse(), people: [...map.people].reverse() };
    const b = layoutLiveMap(shuffled, SIZE);
    const byId = (pts: { id: string }[]) => [...pts].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(byId(b.areas)).toEqual(byId(a.areas));
    expect(byId(b.people)).toEqual(byId(a.people));
  });

  it("her düğüm için bir nokta döner; koordinatlar sonlu; boyut pozitif", () => {
    for (const n of COUNTS)
      for (const m of COUNTS) {
        const l = layoutLiveMap(makeMap(n, m), SIZE);
        expect(l.areas).toHaveLength(n);
        expect(l.people).toHaveLength(m);
        for (const p of [...l.areas, ...l.people]) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        expect(l.width).toBeGreaterThan(0);
        expect(l.height).toBeGreaterThan(0);
      }
  });

  for (const n of COUNTS)
    for (const m of COUNTS)
      it(`${n} alan x ${m} kişi: hiçbir iki düğüm kutusu kesişmez`, () => {
        for (const linksPer of [1, 2]) {
          const l = layoutLiveMap(makeMap(n, m, linksPer), SIZE);
          const bs = boxes(l);
          for (let i = 0; i < bs.length; i++)
            for (let j = i + 1; j < bs.length; j++) {
              const a = bs[i]!;
              const b = bs[j]!;
              const hit = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
              expect(hit, `${a.id} ile ${b.id} kesişiyor`).toBe(false);
            }
        }
      });

  it("tüm düğümler dönen width/height içinde kalır", () => {
    const l = layoutLiveMap(makeMap(7, 30, 2), SIZE);
    // Koordinat orijini belirsiz olabilir: kutuların kapladığı genişlik tuvalden büyük olamaz.
    const bs = boxes(l);
    const w = Math.max(...bs.map((b) => b.x1)) - Math.min(...bs.map((b) => b.x0));
    const h = Math.max(...bs.map((b) => b.y1)) - Math.min(...bs.map((b) => b.y0));
    expect(w).toBeLessThanOrEqual(l.width + 1e-6);
    expect(h).toBeLessThanOrEqual(l.height + 1e-6);
  });

  it("kişi, bağlı olduğu alana, bağlı olmadığı alanların çoğundan yakın açıda durur", () => {
    const map = makeMap(7, 7, 1);
    const l = layoutLiveMap(map, SIZE);
    // Merkez: alanların ağırlık merkezi (halka merkezi).
    const cx = l.areas.reduce((s, a) => s + a.x, 0) / l.areas.length;
    const cy = l.areas.reduce((s, a) => s + a.y, 0) / l.areas.length;
    const ang = (p: { x: number; y: number }) => Math.atan2(p.y - cy, p.x - cx);
    const diff = (a: number, b: number) => {
      const d = Math.abs(a - b) % (Math.PI * 2);
      return d > Math.PI ? Math.PI * 2 - d : d;
    };
    for (const link of map.links) {
      const person = l.people.find((p) => p.id === link.userId)!;
      const own = l.areas.find((a) => a.id === link.areaId)!;
      const dOwn = diff(ang(person), ang(own));
      const farther = l.areas.filter((a) => a.id !== own.id && diff(ang(person), ang(a)) > dOwn).length;
      expect(farther, `${person.id} -> ${own.id}`).toBeGreaterThanOrEqual(5);
    }
  });

  it("iki alana bağlı kişi, iki alanın arasında durur", () => {
    const map = makeMap(4, 0);
    map.people.push({ id: "p-x", name: "X", homeAreaId: null });
    for (const k of [0, 1])
      map.links.push({ ticketId: `tx${k}`, title: "T", areaId: map.areas[k]!.id, userId: "p-x", status: "taken", takenAt: null, paused: false });
    const l = layoutLiveMap(map, SIZE);
    const p = l.people[0]!;
    const dist = (a: { x: number; y: number }) => Math.hypot(a.x - p.x, a.y - p.y);
    const near = Math.max(dist(l.areas[0]!), dist(l.areas[1]!));
    expect(near).toBeLessThan(Math.min(dist(l.areas[2]!), dist(l.areas[3]!)) + 1e-6);
  });
});
