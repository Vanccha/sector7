/**
 * Canlı çalışma haritası yerleşimi — saf, deterministik (ad, sonra id sırası), DOM ve rastgelelik yok.
 *
 * Alanlar (aktif olanlar dış katmanda, boşlar içte; bkz. place): ortada eksenel (kesik köşeli, düz tepeli) altıgen ızgarası — bal peteği. Hücre kümesi sayıya göre sabit
 *   desenle seçilir ve ağırlık merkezi orijine alınır, böylece küme her zaman simetrik durur:
 *   n=1 merkez · 2 çapraz çift · 3 üçgen · 4 elmas (1-2-1) · 5 merkez+4 köşegen (papyon) · 6 üçgen (1-2-3)
 *   · 7 merkez + 6'lık halka · 8+ ikinci/üçüncü halka (halka hücreleri eşit aralıkla seçilir).
 *   Komşu altıgen merkezleri arası sabit `CELL` (= yükseklik + küçük boşluk).
 * Kişiler: kümeyi çevreleyen tam dairede. Kişinin açısı, bağlı olduğu alanların merkez açılarının dairesel
 *   ortalaması (merkezdeki alanın açısı yok; bağlantısı yalnız ona/belirsiz olanlar halkaya eşit dağıtılır).
 *   Kişiler açıya göre sıralanır, en küçük açısal aralıkla yayılır (sıra korunur); çakışma varsa halka büyür.
 */
import type { LiveMap } from "@/lib/contracts/live-map";

export type LayoutPoint = { id: string; x: number; y: number };
export type LiveMapLayout = { areas: LayoutPoint[]; people: LayoutPoint[]; width: number; height: number };

const TAU = Math.PI * 2;
/** Alan altıgeni gövde ölçüsü (Dugum NODE_SIZES.area ile aynı). */
const HEX_W = 160;
const HEX_H = 140;
/** Komşu altıgen merkezleri arası uzaklık: yükseklik + sabit küçük boşluk. */
const CELL = HEX_H + 8;
const PERSON_SPACING = 170;
const PERSON_GAP = 30;
const PAD = 24;
const SEP = 8;
/** Düğüm merkezinden kutu kenarlarına uzaklık (kişide alt etiket dâhil). */
export const NODE_BOX = {
  area: { l: HEX_W / 2, r: HEX_W / 2, t: HEX_H / 2, b: HEX_H / 2 },
  person: { l: 56, r: 56, t: 26, b: 62 },
} as const;

type Box = { id: string; x0: number; y0: number; x1: number; y1: number };
const cmp = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function boxOf(pt: LayoutPoint, b: { l: number; r: number; t: number; b: number }): Box {
  return { id: pt.id, x0: pt.x - b.l, x1: pt.x + b.r, y0: pt.y - b.t, y1: pt.y + b.b };
}
const hit = (a: Box, b: Box) => a.x0 < b.x1 + SEP && b.x0 < a.x1 + SEP && a.y0 < b.y1 + SEP && b.y0 < a.y1 + SEP;

/**
 * Saf kontrol: hiçbir iki düğüm çakışmıyorsa false. Alan-alan: altıgenler iç içe geçtiği için (petek) kutu yerine
 * merkez uzaklığına bakılır (>= altıgen yüksekliği); diğer çiftlerde kutular (en az SEP boşlukla).
 */
export function layoutHasOverlap(layout: Pick<LiveMapLayout, "areas" | "people">): boolean {
  const { areas, people } = layout;
  for (let i = 0; i < areas.length; i++)
    for (let j = i + 1; j < areas.length; j++)
      if (Math.hypot(areas[i]!.x - areas[j]!.x, areas[i]!.y - areas[j]!.y) < HEX_H - 1e-6) return true;
  const ab = areas.map((a) => boxOf(a, NODE_BOX.area));
  const pb = people.map((p) => boxOf(p, NODE_BOX.person));
  for (const p of pb) for (const a of ab) if (hit(p, a)) return true;
  for (let i = 0; i < pb.length; i++) for (let j = i + 1; j < pb.length; j++) if (hit(pb[i]!, pb[j]!)) return true;
  return false;
}

/* ---- Petek hücreleri (eksenel koordinat: a*e1 + b*e2; e1 = -30°, e2 = +30°, aralarında 60°) ---- */
type Axial = readonly [number, number];
const E1 = { x: CELL * Math.cos(Math.PI / 6), y: -CELL / 2 };
const E2 = { x: CELL * Math.cos(Math.PI / 6), y: CELL / 2 };
const toXY = ([a, b]: Axial) => ({ x: a * E1.x + b * E2.x, y: a * E1.y + b * E2.y });
const DIRS: Axial[] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

const SMALL: Record<number, Axial[]> = {
  1: [[0, 0]],
  2: [[0, 0], [1, 0]],
  3: [[0, 0], [1, 0], [0, 1]],
  4: [[0, 0], [-1, 1], [-1, 0], [0, 1]],
  5: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]],
  6: [[0, 0], [1, 0], [0, 1], [2, 0], [1, 1], [0, 2]],
};

function ring(r: number): Axial[] {
  const out: Axial[] = [];
  let a = DIRS[4]![0] * r;
  let b = DIRS[4]![1] * r;
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < r; j++) {
      out.push([a, b]);
      a += DIRS[i]![0];
      b += DIRS[i]![1];
    }
  return out;
}

/** Saat yönünde, tepeden başlayan açı (0..TAU). */
const clockAngle = (x: number, y: number) => ((Math.atan2(x, -y) % TAU) + TAU) % TAU;

function cellPositions(n: number): { x: number; y: number }[] {
  let cells: Axial[];
  if (n <= 6) cells = SMALL[n] ?? [];
  else {
    cells = [[0, 0]];
    let left = n - 1;
    for (let r = 1; left > 0; r++) {
      const rc = ring(r);
      const take = Math.min(left, rc.length);
      const picked = Array.from({ length: take }, (_, j) => rc[Math.floor((j * rc.length) / take)]!);
      cells.push(...picked);
      left -= take;
    }
  }
  const pts = cells.map(toXY);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const c = pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  return c;
}


/* ---- Dış katman yerleşiminin eniyilemesi: birlikte çalışılan alanlar yan yana ---- */
type Pt = { x: number; y: number };
const angleOf = (p: Pt) => ((Math.atan2(p.y, p.x) % TAU) + TAU) % TAU;

/** Açıların kapsadığı en küçük dairesel yay uzunluğu (rad). */
function arcSpan(angles: number[]): number {
  if (angles.length < 2) return 0;
  const a = [...angles].sort((x, y) => x - y);
  let maxGap = a[0]! + TAU - a[a.length - 1]!;
  for (let i = 0; i + 1 < a.length; i++) maxGap = Math.max(maxGap, a[i + 1]! - a[i]!);
  return TAU - maxGap;
}

/** Kişinin halkadaki açısı: bağlı alan açılarının dairesel ortalaması (dejenereyse yay ortası). */
function personAngle(angles: number[]): number {
  let sx = 0;
  let sy = 0;
  for (const t of angles) {
    sx += Math.cos(t);
    sy += Math.sin(t);
  }
  if (Math.hypot(sx, sy) > 1e-6) return Math.atan2(sy, sx);
  const a = [...angles].sort((x, y) => x - y);
  let gi = a.length - 1;
  let maxGap = a[0]! + TAU - a[gi]!;
  for (let i = 0; i + 1 < a.length; i++)
    if (a[i + 1]! - a[i]! > maxGap) {
      maxGap = a[i + 1]! - a[i]!;
      gi = i;
    }
  return a[(gi + 1) % a.length]! + (TAU - maxGap) / 2;
}

type Seg = { person: number; x0: number; y0: number; x1: number; y1: number };
function properCross(a: Seg, b: Seg): boolean {
  const d = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const e = 1e-6;
  const d1 = d(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0);
  const d2 = d(a.x0, a.y0, a.x1, a.y1, b.x1, b.y1);
  const d3 = d(b.x0, b.y0, b.x1, b.y1, a.x0, a.y0);
  const d4 = d(b.x0, b.y0, b.x1, b.y1, a.x1, a.y1);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

/** Maliyet: [toplam kişi yayı, kişi çizgisi kesişme sayısı]; kesişme yalnız `withCross` ise hesaplanır. */
function placementCost(persons: string[][], pos: Map<string, Pt>, clusterR: number, withCross: boolean): [number, number] {
  let span = 0;
  const segs: Seg[] = [];
  persons.forEach((areaIds, pi) => {
    const pts = areaIds.map((id) => pos.get(id)).filter((p): p is Pt => !!p && Math.hypot(p.x, p.y) >= 1);
    if (pts.length === 0) return;
    const angles = pts.map(angleOf);
    span += arcSpan(angles);
    if (withCross) {
      const th = personAngle(angles);
      const R = clusterR * 2;
      for (const p of pts) segs.push({ person: pi, x0: R * Math.cos(th), y0: R * Math.sin(th), x1: p.x, y1: p.y });
    }
  });
  let cross = 0;
  if (withCross)
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) if (segs[i]!.person !== segs[j]!.person && properCross(segs[i]!, segs[j]!)) cross++;
  return [span, cross];
}

/**
 * Bir katmanın üyelerini (varsayılan ad sırası) hücrelere (saat yönü) dağıtır: önce toplam kişi yayı, sonra kesişme
 * sayısı en küçük olan seçilir; eşitlikte varsayılan sıra kazanır. ≤7 üye: tüm permütasyonlar (varsayılan sıra
 * ilk denenir, yalnız kesin iyileşme kabul edilir); fazlası: açgözlü yerleştirme + 2-opt.
 */
function optimizeRing<T extends { id: string }>(members: T[], cells: Pt[], fixed: Map<string, Pt>, persons: string[][], clusterR: number): T[] {
  const k = members.length;
  const EPS = 1e-9;
  if (k < 2 || persons.every((p) => p.length < 2)) return members;
  const costOf = (order: T[], withCross: boolean) => {
    const pos = new Map(fixed);
    order.forEach((m, i) => pos.set(m.id, cells[i]!));
    return placementCost(persons, pos, clusterR, withCross);
  };
  const better = (a: [number, number], b: [number, number]) => a[0] < b[0] - EPS || (Math.abs(a[0] - b[0]) <= EPS && a[1] < b[1]);
  const full = (order: T[]) => costOf(order, true);

  if (k <= 7) {
    let best = members;
    let bestCost = full(members);
    const used = new Array<boolean>(k).fill(false);
    const cur: T[] = [];
    const rec = () => {
      if (cur.length === k) {
        const c0 = costOf(cur, false);
        if (c0[0] > bestCost[0] + EPS) return;
        const c = full(cur);
        if (better(c, bestCost)) {
          best = [...cur];
          bestCost = c;
        }
        return;
      }
      for (let i = 0; i < k; i++) {
        if (used[i]) continue;
        used[i] = true;
        cur.push(members[i]!);
        rec();
        cur.pop();
        used[i] = false;
      }
    };
    rec();
    return best;
  }

  // Açgözlü: paylaşılan alanlar önce (üyeler zaten öyle sıralı değil → kişi sayısına göre), en ucuz boş hücreye.
  const share = (m: T) => persons.filter((p) => p.includes(m.id)).length;
  const seq = members.map((m, i) => ({ m, i })).sort((a, b) => share(b.m) - share(a.m) || a.i - b.i);
  const slot: (T | null)[] = new Array(k).fill(null);
  for (const { m } of seq) {
    let bc = -1;
    let bv: [number, number] = [Infinity, Infinity];
    for (let c = 0; c < k; c++) {
      if (slot[c]) continue;
      const pos = new Map(fixed);
      slot.forEach((s, i) => s && pos.set(s.id, cells[i]!));
      pos.set(m.id, cells[c]!);
      const v = placementCost(persons, pos, clusterR, false);
      if (v[0] < bv[0] - EPS) {
        bv = v;
        bc = c;
      }
    }
    slot[bc] = m;
  }
  let order = slot as T[];
  let cost = full(order);
  for (let pass = 0; pass < 12; pass++) {
    let improved = false;
    for (let i = 0; i < k; i++)
      for (let j = i + 1; j < k; j++) {
        const t = [...order];
        [t[i], t[j]] = [t[j]!, t[i]!];
        const c = full(t);
        if (better(c, cost)) {
          order = t;
          cost = c;
          improved = true;
        }
      }
    if (!improved) break;
  }
  // Greedy/2-opt varsayılan sıradan daha kötüyse varsayılan kalsın.
  return better(full(members), cost) || !better(cost, full(members)) ? members : order;
}

function place(map: LiveMap, k: number) {
  const areas = [...map.areas].sort(cmp);
  const people = [...map.people].sort(cmp);
  const n = areas.length;
  const m = people.length;

  // Hücre ataması aktifliğe göre: hücreler dıştan içe (merkeze uzaklığa göre azalan) doldurulur, alanlar
  // activeCount'a göre azalan (eşitlikte ad, id) bu hücrelere gider. Aynı uzaklık katmanındaki alanlar kendi
  // içinde ad sırasıyla, hücreler saat yönünde (tepeden) eşleşir. Böylece bağlantılı alanlar dışta, boşlar içte durur.
  const linked = new Map<string, Set<string>>();
  for (const l of map.links) {
    if (!linked.has(l.userId)) linked.set(l.userId, new Set());
    linked.get(l.userId)!.add(l.areaId);
  }
  const areaIds = new Set(areas.map((a) => a.id));
  const persons = [...linked.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, set]) => [...set].filter((id) => areaIds.has(id)).sort());
  const hasLink = new Set(persons.flat());
  const shared = new Map<string, number>();
  for (const ids of persons) for (const id of ids) shared.set(id, (shared.get(id) ?? 0) + ids.length - 1);

  const cells = cellPositions(n);
  const dist = (c: { x: number; y: number }) => Math.round(Math.hypot(c.x, c.y) / 10);
  cells.sort((p, q) => dist(q) - dist(p));
  const clusterR0 = cells.reduce((mx, c) => Math.max(mx, Math.hypot(c.x, c.y)), 0) + HEX_W / 2;
  // Dıştan içe: bağlantılı alanlar önce; sığmazsa en çok paylaşılanlar dışta (sonra activeCount, ad, id).
  const ranked = [...areas].sort(
    (a, b) =>
      Number(hasLink.has(b.id)) - Number(hasLink.has(a.id)) ||
      (shared.get(b.id) ?? 0) - (shared.get(a.id) ?? 0) ||
      b.activeCount - a.activeCount ||
      cmp(a, b),
  );
  const areaPts: LayoutPoint[] = [];
  const fixed = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && dist(cells[j]!) === dist(cells[i]!)) j++;
    const ring = cells.slice(i, j).sort((p, q) => clockAngle(p.x, p.y) - clockAngle(q.x, q.y));
    const group = optimizeRing(ranked.slice(i, j).sort(cmp), ring, fixed, persons, clusterR0);
    group.forEach((a, g) => {
      areaPts.push({ id: a.id, x: ring[g]!.x, y: ring[g]!.y });
      fixed.set(a.id, ring[g]!);
    });
    i = j;
  }
  const areaAngle = new Map<string, number | null>();
  for (const p of areaPts) areaAngle.set(p.id, Math.hypot(p.x, p.y) < 1 ? null : Math.atan2(p.y, p.x));

  const clusterR = areaPts.reduce((mx, p) => Math.max(mx, Math.hypot(p.x, p.y)), 0) + HEX_W / 2;
  const R = m === 0 ? 0 : Math.max(clusterR + NODE_BOX.person.b + PERSON_GAP, (m * PERSON_SPACING) / TAU) * k;

  const defined: { id: string; th: number }[] = [];
  const free: string[] = [];
  for (const p of people) {
    let sx = 0;
    let sy = 0;
    for (const aid of linked.get(p.id) ?? []) {
      const th = areaAngle.get(aid);
      if (th == null) continue;
      sx += Math.cos(th);
      sy += Math.sin(th);
    }
    if (Math.hypot(sx, sy) > 1e-6) defined.push({ id: p.id, th: ((Math.atan2(sy, sx) % TAU) + TAU) % TAU });
    else free.push(p.id);
  }
  // Açısı olmayanlar (merkezdeki alan / simetrik zıt alanlar): halkaya eşit dağıt.
  const evenly = free.map((id, i) => ({ id, th: (((-Math.PI / 2 + (i * TAU) / free.length) % TAU) + TAU) % TAU }));
  const order = [...defined, ...evenly].sort((a, b) => a.th - b.th || (a.id < b.id ? -1 : 1));

  if (m > 1) {
    const chord = 2 * Math.asin(Math.min(1, PERSON_SPACING / (2 * R)));
    const gap = Math.min(chord, TAU / m) * 0.98;
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
    return { id: p.id, x: R * Math.cos(th), y: R * Math.sin(th) };
  });
  return { areas: areaPts, people: peoplePts };
}

/**
 * `size` artık yerleşimi etkilemez (petek sabit ölçülüdür); imza uyumluluğu için kalır. Dönen `width/height`
 * düğümlerin sınır kutusuna (PAD ile) kırpılmıştır, koordinatlar bu kutuya göredir.
 * Kişi kutuları çakışıyorsa yalnız dış halka büyütülür.
 */
export function layoutLiveMap(map: LiveMap, size?: { width: number; height: number }): LiveMapLayout {
  void size;
  let k = 1;
  let res = place(map, k);
  for (let it = 0; it < 40 && layoutHasOverlap(res); it++) {
    k *= 1.05;
    res = place(map, k);
  }
  const bs = [...res.areas.map((a) => boxOf(a, NODE_BOX.area)), ...res.people.map((p) => boxOf(p, NODE_BOX.person))];
  if (bs.length === 0) return { areas: [], people: [], width: PAD * 2, height: PAD * 2 };
  // Yatayda simetrik sınır: petek merkezi tuvalin ortasında kalır; dikeyde sıkı.
  const hw = Math.max(...bs.map((b) => Math.max(Math.abs(b.x0), Math.abs(b.x1)))) + PAD;
  const minX = -hw;
  const maxX = hw;
  const minY = Math.min(...bs.map((b) => b.y0)) - PAD;
  const maxY = Math.max(...bs.map((b) => b.y1)) + PAD;
  // Tam sayıya yuvarla: sunucu/istemci trigonometri farkları hidrasyon uyuşmazlığı yaratmasın.
  const shift = (pts: LayoutPoint[]) => pts.map((p) => ({ id: p.id, x: Math.round(p.x - minX), y: Math.round(p.y - minY) }));
  return { areas: shift(res.areas), people: shift(res.people), width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}
