/**
 * Canlı çalışma haritası yerleşimi — saf, deterministik (id sırası), DOM yok.
 *
 * - Alanlar merkezde bir elips üzerinde eşit açıyla (1 alan: merkez, 2 alan: yatay).
 * - Kişiler dış elipste; kişinin açısı, bağlı olduğu alanların açılarının dairesel ortalaması.
 * - Düğüm kutuları (düğüm + alt etiket) çiftler hâlinde kesişmeyene dek halkalar büyütülür (`layoutHasOverlap`).
 * - Aynı açıya düşenler açı aralığı (gap) korunarak iteratif iterek ayrılır; kişi çoksa halka büyür,
 *   dönen `width/height` istenen boyuttan büyük olabilir (tuval o kadar genişler).
 */
import type { LiveMap } from "@/lib/contracts/live-map";

export type LayoutPoint = { id: string; x: number; y: number };
export type LiveMapLayout = { areas: LayoutPoint[]; people: LayoutPoint[]; width: number; height: number };

const TAU = Math.PI * 2;
const AREA_SPACING = 190;
const PERSON_SPACING = 162;
const RING_GAP = 170;
const PAD = 24;
const SEP = 8;
/** Düğüm merkezinden kutu kenarlarına uzaklık (alt etiket dâhil). */
export const NODE_BOX = {
  area: { l: 75, r: 75, t: 47, b: 100 },
  person: { l: 56, r: 56, t: 26, b: 62 },
} as const;

type Box = { id: string; x0: number; y0: number; x1: number; y1: number };
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function boxesOf(layout: Pick<LiveMapLayout, "areas" | "people">): Box[] {
  const mk = (pt: LayoutPoint, b: { l: number; r: number; t: number; b: number }): Box => ({
    id: pt.id,
    x0: pt.x - b.l,
    x1: pt.x + b.r,
    y0: pt.y - b.t,
    y1: pt.y + b.b,
  });
  return [...layout.areas.map((a) => mk(a, NODE_BOX.area)), ...layout.people.map((p) => mk(p, NODE_BOX.person))];
}

/** Saf kontrol: hiçbir iki düğüm kutusu (en az SEP boşlukla) kesişmiyorsa false. */
export function layoutHasOverlap(layout: Pick<LiveMapLayout, "areas" | "people">): boolean {
  const bs = boxesOf(layout);
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i]!;
      const b = bs[j]!;
      if (a.x0 < b.x1 + SEP && b.x0 < a.x1 + SEP && a.y0 < b.y1 + SEP && b.y0 < a.y1 + SEP) return true;
    }
  }
  return false;
}

function place(map: LiveMap, size: { width: number; height: number }, k: number) {
  const areas = [...map.areas].sort(byId);
  const people = [...map.people].sort(byId);
  const n = areas.length;
  const m = people.length;
  const rx0 = Math.max(size.width / 2 - 100, 120);
  const ry0 = Math.max(size.height / 2 - 125, 100);

  let ax = 0;
  let ay = 0;
  if (n === 2) ax = Math.max(rx0 * 0.3, 100);
  else if (n >= 3) {
    ax = Math.max(rx0 * 0.36, (n * AREA_SPACING) / TAU);
    ay = ax * clamp(ry0 / rx0, 0.55, 1);
  }
  ax *= k;
  ay *= k;
  const need = (m * PERSON_SPACING) / TAU;
  const Rx = m === 0 ? 0 : Math.max(rx0 * k, ax + RING_GAP, need * k);
  const Ry = m === 0 ? 0 : Math.max(ry0 * k, ay + RING_GAP, need * k);

  const areaAngle = new Map<string, number | null>();
  const areaPts: LayoutPoint[] = areas.map((a, i) => {
    if (n === 1) {
      areaAngle.set(a.id, null);
      return { id: a.id, x: 0, y: 0 };
    }
    const th = n === 2 ? (i === 0 ? Math.PI : 0) : -Math.PI / 2 + (i * TAU) / n;
    areaAngle.set(a.id, th);
    return { id: a.id, x: ax * Math.cos(th), y: ay * Math.sin(th) };
  });

  const linked = new Map<string, Set<string>>();
  for (const l of map.links) {
    if (!linked.has(l.userId)) linked.set(l.userId, new Set());
    linked.get(l.userId)!.add(l.areaId);
  }
  const raw = people.map((p, i) => {
    let sx = 0;
    let sy = 0;
    for (const aid of linked.get(p.id) ?? []) {
      const th = areaAngle.get(aid);
      if (th == null) continue;
      sx += Math.cos(th);
      sy += Math.sin(th);
    }
    const th = Math.hypot(sx, sy) > 1e-6 ? Math.atan2(sy, sx) : -Math.PI / 2 + (i * TAU) / Math.max(m, 1);
    return { id: p.id, th: ((th % TAU) + TAU) % TAU };
  });

  const order = [...raw].sort((a, b) => a.th - b.th || (a.id < b.id ? -1 : 1));
  if (m > 1) {
    const gap = Math.min(PERSON_SPACING / Math.min(Rx, Ry), TAU / m) * 0.98;
    const a = order.map((o) => o.th);
    const diffOf = (i: number) => {
      const j = (i + 1) % m;
      return (a[j] ?? 0) - (a[i] ?? 0) + (j === 0 ? TAU : 0);
    };
    for (let it = 0; it < 400; it++) {
      let moved = false;
      for (let i = 0; i < m; i++) {
        const d = diffOf(i);
        if (d < gap - 1e-9) {
          const push = (gap - d) / 2;
          a[i] = (a[i] ?? 0) - push;
          a[(i + 1) % m] = (a[(i + 1) % m] ?? 0) + push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    let ok = true;
    for (let i = 0; i < m; i++) if (diffOf(i) < gap * 0.9) ok = false;
    if (!ok) for (let i = 0; i < m; i++) a[i] = (order[0]?.th ?? 0) + (i * TAU) / m;
    order.forEach((o, i) => (o.th = a[i] ?? o.th));
  }
  const thById = new Map(order.map((o) => [o.id, o.th]));
  const peoplePts: LayoutPoint[] = people.map((p) => {
    const th = thById.get(p.id) ?? 0;
    return { id: p.id, x: Rx * Math.cos(th), y: Ry * Math.sin(th) };
  });
  return { areas: areaPts, people: peoplePts };
}

/**
 * `size` yalnız hedef en-boy oranı/başlangıç ölçeği içindir; dönen `width/height` düğümlerin sınır kutusuna
 * (PAD ile) kırpılmıştır, koordinatlar bu kutuya göredir. Çakışma kalmayana dek halkalar büyütülür.
 */
export function layoutLiveMap(map: LiveMap, size: { width: number; height: number }): LiveMapLayout {
  const sz = { width: Math.max(size.width, 320), height: Math.max(size.height, 320) };
  let k = 1;
  let res = place(map, sz, k);
  for (let it = 0; it < 25 && layoutHasOverlap(res); it++) {
    k *= 1.08;
    res = place(map, sz, k);
  }
  const bs = boxesOf(res);
  if (bs.length === 0) return { areas: [], people: [], width: PAD * 2, height: PAD * 2 };
  const minX = Math.min(...bs.map((b) => b.x0)) - PAD;
  const minY = Math.min(...bs.map((b) => b.y0)) - PAD;
  const maxX = Math.max(...bs.map((b) => b.x1)) + PAD;
  const maxY = Math.max(...bs.map((b) => b.y1)) + PAD;
  const shift = (pts: LayoutPoint[]) => pts.map((p) => ({ id: p.id, x: p.x - minX, y: p.y - minY }));
  return { areas: shift(res.areas), people: shift(res.people), width: maxX - minX, height: maxY - minY };
}
