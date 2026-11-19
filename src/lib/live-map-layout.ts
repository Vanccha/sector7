/**
 * Canlı çalışma haritası yerleşimi — saf, deterministik (ad, sonra id sırası), DOM ve rastgelelik yok.
 *
 * A) Alan halkası 1: orijin merkez; alanlar bir ÇEMBER üzerinde eşit açıyla, tepeden saat yönünde, ad sırasıyla dizilir
 *    (boş alanlar da sırada yer alır). R1 = max(komşu altıgenler çakışmasın, kişilerin sığacağı iç bölge). Altıgenler hep
 *    aynı yönde; döndürme yok.
 * B) Halka 2: halka-1 kapasitesi N1MAX = 14 (yarıçap ~380px; daha fazlası tuvali gereksiz genişletir ve altıgenler
 *    okunmaz hâle gelmez, ama ikinci halka kompakt kalır). Aktif (bağlantılı) alanlar önce halka-1'e girer; aktif sayısı
 *    N1MAX'ı aşarsa halka-1 büyür. Kalan BOŞ alanlar halka-2'ye gider: R2 ≈ R1 + altıgen yüksekliği + boşluk, yarım adım
 *    kaydırılmış, eşit açılı. Halka-2'ye bağlantı gitmez.
 * C) Kişiler merkezde, iki iç halka: v = bağlı alan birim vektörlerinin ortalaması, θ = atan2(v), m = |v|. m ≥ 0.5 olanlar
 *    dış iç halkada (0.62·Rin), m < 0.5 olanlar iç iç halkada (0.28·Rin); her halkada θ'ya göre sıralı, kendi açısında,
 *    komşular arası en az MIN_CHORD (döngüsel yarı yarıya itme). Sığmazsa önce dış halka (üst sınır R1 − 70 − etiket payı),
 *    sonra R1 büyür. Arama yok; çakışma ya da yabancı altıgen kesişimi olursa aynı sırayla büyütülür.
 * D) Bağlantılar: kişi gövdesinden alan altıgeninin kişiye bakan kenarındaki en yakın noktaya düz çizgi.
 */
import type { LiveMap } from "@/lib/contracts/live-map";

export type LayoutPoint = { id: string; x: number; y: number };
export type LayoutLink = {
  /** `${userId}|${areaId}` */
  key: string;
  userId: string;
  areaId: string;
  type: "line";
  /** SVG path `d` (tam sayı koordinat): düz çizgi. */
  d: string;
  /** Çizginin uç noktaları, kesişim testleri için. */
  pts: { x: number; y: number }[];
  /** Çizginin ortası (rozet için). */
  mid: { x: number; y: number };
};
export type LiveMapLayout = { areas: LayoutPoint[]; people: LayoutPoint[]; links: LayoutLink[]; width: number; height: number };

const TAU = Math.PI * 2;
/** Alan altıgeni gövde ölçüsü (Dugum NODE_SIZES.area ile aynı). */
const HEX_W = 160;
const HEX_H = 140;
const GAP = 8;
const PAD = 24;
const SEP = 8;
/** Halka-1 en çok bu kadar alan alır (aktifler fazlaysa büyür). */
export const N1MAX = 14;
/** Kişi düğümü gövde yarıçapı (çizgi başlangıcı). */
const PERSON_R = 30;
/** Kişi gövdesi + ad etiketinin ilk satırı (çizgi–kişi kesişim testi) + pay. */
const BODY = { hx: 30 + 3, top: 26 + 3, bottom: 52 };
/** İki iç halka: dış (m ≥ M_SPLIT) ve iç (m < M_SPLIT) yarıçapları, iç bölge yarıçapının katı. */
const R_OUT = 0.62;
const R_MID = 0.28;
const M_SPLIT = 0.5;
/** Aynı halkada komşu kişi merkezleri arası en az uzaklık (112x88 kutular + SEP hiçbir yönde çakışmaz). */
const MIN_CHORD = 156;
/** İki halka arası en az yarıçap farkı. */
const RING_GAP = 100;
/** Hedef açıdan en çok sapma (itme sonrası). */
const MAX_DEV = (25 * Math.PI) / 180;
/** Kişi ad etiketi payı (dış halka sınırı: R1 − altıgen yarı yüksekliği − pay). */
const LABEL_PAD = 30;
/** İç bölge payı (kişi kutusunun yarısı kadar). */
const INNER_PAD = 60;
/** Altıgen çokgeni kesişim testinde bu kadar şişirilir (px). */
const HEX_MARGIN = 2;
/** Düğüm merkezinden kutu kenarlarına uzaklık (kişide alt etiket dâhil). */
export const NODE_BOX = {
  area: { l: HEX_W / 2, r: HEX_W / 2, t: HEX_H / 2, b: HEX_H / 2 },
  person: { l: 56, r: 56, t: 26, b: 62 },
} as const;

/** Alan altıgeni köşeleri, merkeze göre (Dugum `hex` poligonu: 25/75 %, 2/98 %, 40/60 %). */
export const HEX_POLY: readonly (readonly [number, number])[] = [
  [-40, -70], [40, -70], [76.8, -14], [76.8, 14], [40, 70], [-40, 70], [-76.8, 14], [-76.8, -14],
];

type Pt = { x: number; y: number };
type Box = { id: string; x0: number; y0: number; x1: number; y1: number };
// Türkçe ad sırası (sunucudaki byName ile aynı: "İçerik" D'den sonra, Y'den önce); eşitlikte id.
const trCollator = new Intl.Collator("tr");
const cmp = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  trCollator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function boxOf(pt: LayoutPoint, b: { l: number; r: number; t: number; b: number }): Box {
  return { id: pt.id, x0: pt.x - b.l, x1: pt.x + b.r, y0: pt.y - b.t, y1: pt.y + b.b };
}
const hit = (a: Box, b: Box) => a.x0 < b.x1 + SEP && b.x0 < a.x1 + SEP && a.y0 < b.y1 + SEP && b.y0 < a.y1 + SEP;

/* ---- Geometri yardımcıları ---- */
const hexAt = (c: Pt, grow = 0): Pt[] => {
  const s = 1 + grow / 70;
  return HEX_POLY.map(([x, y]) => ({ x: c.x + x * s, y: c.y + y * s }));
};
const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Pt, q: Pt, r: Pt) =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}
function insideConvex(poly: Pt[], p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(poly[i]!, poly[(i + 1) % poly.length]!, p);
    if (c !== 0) {
      if (sign === 0) sign = c > 0 ? 1 : -1;
      else if (sign !== (c > 0 ? 1 : -1)) return false;
    }
  }
  return true;
}
function segHitsPoly(a: Pt, b: Pt, poly: Pt[]): boolean {
  if (insideConvex(poly, a) || insideConvex(poly, b)) return true;
  for (let i = 0; i < poly.length; i++) if (segSeg(a, b, poly[i]!, poly[(i + 1) % poly.length]!)) return true;
  return false;
}
function nearestOnPoly(poly: Pt[], p: Pt): Pt {
  let best = poly[0]!;
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd - 1e-9) {
      bd = d;
      best = q;
    }
  }
  return best;
}

function polysIntersect(a: Pt[], b: Pt[]): boolean {
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) if (segSeg(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
  return insideConvex(a, b[0]!) || insideConvex(b, a[0]!);
}

/**
 * Saf kontrol: hiçbir iki düğüm çakışmıyorsa false. Alan-alan: altıgen çokgenleri kesişmemeli; kişi-kişi ve kişi-alan:
 * kutular (en az SEP boşlukla).
 */
export function layoutHasOverlap(layout: Pick<LiveMapLayout, "areas" | "people">): boolean {
  const { areas, people } = layout;
  const polys = areas.map((a) => hexAt(a));
  for (let i = 0; i < areas.length; i++)
    for (let j = i + 1; j < areas.length; j++) if (polysIntersect(polys[i]!, polys[j]!)) return true;
  const ab = areas.map((a) => boxOf(a, NODE_BOX.area));
  const pb = people.map((p) => boxOf(p, NODE_BOX.person));
  for (const p of pb) for (const a of ab) if (hit(p, a)) return true;
  for (let i = 0; i < pb.length; i++) for (let j = i + 1; j < pb.length; j++) if (hit(pb[i]!, pb[j]!)) return true;
  return false;
}

/**
 * Saf kontrol: çizgi, hedef alan dışındaki herhangi bir altıgeni (HEX_MARGIN şişirilmiş) kesiyor mu.
 * Düzen koordinatlarında çalışır (`layout.areas`, `link.pts`).
 */
export function linkCrossesForeignHex(layout: Pick<LiveMapLayout, "areas">, link: Pick<LayoutLink, "areaId" | "pts">): boolean {
  const polys = layout.areas.filter((a) => a.id !== link.areaId).map((a) => hexAt(a, HEX_MARGIN));
  for (let i = 0; i + 1 < link.pts.length; i++)
    for (const poly of polys) if (segHitsPoly(link.pts[i]!, link.pts[i + 1]!, poly)) return true;
  return false;
}

const bodyPoly = (c: Pt): Pt[] => [
  { x: c.x - BODY.hx, y: c.y - BODY.top },
  { x: c.x + BODY.hx, y: c.y - BODY.top },
  { x: c.x + BODY.hx, y: c.y + BODY.bottom },
  { x: c.x - BODY.hx, y: c.y + BODY.bottom },
];

/** Saf kontrol: çizgi, kendi kişisi dışındaki bir kişinin gövdesini kesiyor mu. */
export function linkCrossesOtherPerson(layout: Pick<LiveMapLayout, "people">, link: Pick<LayoutLink, "userId" | "pts">): boolean {
  for (const p of layout.people) {
    if (p.id === link.userId) continue;
    const poly = bodyPoly(p);
    for (let i = 0; i + 1 < link.pts.length; i++) if (segHitsPoly(link.pts[i]!, link.pts[i + 1]!, poly)) return true;
  }
  return false;
}

/** Komşu altıgenlerin çakışmaması için n'li çemberin en küçük yarıçapı. */
const chordR = (n: number) => (n < 2 ? 0 : (HEX_W + GAP) / (2 * Math.sin(Math.PI / n)));

/** Çember üstünde (tepeden, saat yönünde) `phase` adım kaydırılmış konum. */
const onCircle = (R: number, i: number, n: number, phase: number): Pt => {
  const a = ((i + phase) * TAU) / n;
  return { x: Math.round(R * Math.sin(a)), y: -Math.round(R * Math.cos(a)) };
};

type AreaRings = { pts: LayoutPoint[]; ring1: number };

function placeAreas(map: LiveMap, R1: number): AreaRings {
  const { ring1, ring2 } = splitRings(map);
  const pts: LayoutPoint[] = ring1.map((a, i) => ({ id: a.id, ...onCircle(R1, i, ring1.length, 0) }));
  if (ring2.length > 0) {
    const n2 = ring2.length;
    let R2 = Math.max(R1 + HEX_H + GAP, chordR(n2));
    const mk = (R: number) => ring2.map((a, i) => ({ id: a.id, ...onCircle(R, i, n2, 0.5) }));
    const polys1 = pts.map((p) => hexAt(p));
    const bad = (cand: LayoutPoint[]) => {
      const polys2 = cand.map((p) => hexAt(p));
      return polys2.some((q, i) => polys1.some((r) => polysIntersect(q, r)) || polys2.slice(i + 1).some((r) => polysIntersect(q, r)));
    };
    let cand = mk(R2);
    while (bad(cand)) {
      R2 += 4;
      cand = mk(R2);
    }
    pts.push(...cand);
  }
  return { pts, ring1: ring1.length };
}

function splitRings(map: LiveMap) {
  const sorted = [...map.areas].sort(cmp);
  const linked = new Set(map.links.map((l) => l.areaId));
  const active = (a: LiveMap["areas"][number]) => a.activeCount > 0 || linked.has(a.id);
  const actives = sorted.filter(active);
  const empties = sorted.filter((a) => !active(a));
  const room = Math.max(0, N1MAX - actives.length);
  const n1 = actives.length + Math.min(room, empties.length);
  // Aktifler halkaya eşit aralıklı yuvalara (i·n1/k), boşlar kalan yuvaları ad sırasıyla saat yönünde doldurur.
  const ring1: (typeof sorted)[number][] = new Array(n1);
  actives.forEach((a, i) => (ring1[Math.round((i * n1) / actives.length)] = a));
  let e = 0;
  for (let i = 0; i < n1; i++) if (!ring1[i]) ring1[i] = empties[e++]!;
  return { ring1, ring2: empties.slice(e) };
}

type PersonSpec = { id: string; name: string; areas: string[]; theta: number; mag: number };

/** Çizgi: kişi merkezinden hedef altıgenin en yakın kenar noktasına; başlangıç gövde kenarında. */
function lineOf(q: Pt, c: Pt, poly: Pt[] = hexAt(c)): { start: Pt; end: Pt } {
  const end = nearestOnPoly(poly, q);
  const len = Math.hypot(end.x - q.x, end.y - q.y) || 1;
  return { start: { x: q.x + ((end.x - q.x) / len) * PERSON_R, y: q.y + ((end.y - q.y) / len) * PERSON_R }, end };
}

/**
 * Bir halkadaki kişi açıları (θ'ya göre sıralı, dairesel): ardışık iki kişi arasında en az `delta` açı kalana kadar
 * çiftleri yarı yarıya iter (sıra korunur, açıların ortalaması sabit kalır). Sığmıyorsa null.
 */
function spreadAngles(angles: number[], delta: number): number[] | null {
  const n = angles.length;
  if (n <= 1) return [...angles];
  if (n * delta > TAU - 1e-9) return null;
  const b = [...angles];
  for (let it = 0; it < 400; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const gap = b[j]! - b[i]! + (j === 0 ? TAU : 0);
      if (gap < delta - 1e-9) {
        const d = (delta - gap) / 2;
        b[i] = b[i]! - d;
        b[j] = b[j]! + d;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return b;
}

type Rings = { rOut: number; rMid: number };

/**
 * İki iç halka: m ≥ 0.5 olanlar dış halkada (rOut), m < 0.5 olanlar iç halkada (rMid); her biri kendi θ açısında,
 * komşular arası en az MIN_CHORD uzaklıkla. m≈0 olan tek kişi merkeze konur.
 */
function placeRings(specs: PersonSpec[], { rOut, rMid }: Rings): Map<string, Pt> | null {
  const out = new Map<string, Pt>();
  const groups: [PersonSpec[], number][] = [
    [specs.filter((s) => s.mag >= M_SPLIT), rOut],
    [specs.filter((s) => s.mag < M_SPLIT), rMid],
  ];
  for (const [g, r] of groups) {
    if (g.length === 0) continue;
    if (g.length === 1 && g[0]!.mag < 1e-6) {
      out.set(g[0]!.id, { x: 0, y: 0 });
      continue;
    }
    const sorted = [...g]
      .map((s) => ({ s, t: ((s.theta % TAU) + TAU) % TAU }))
      .sort((p, q) => p.t - q.t || cmp(p.s, q.s));
    const ang = spreadAngles(sorted.map((e) => e.t), MIN_CHORD / Math.max(r, 1));
    if (!ang) return null;
    sorted.forEach((e, i) => out.set(e.s.id, { x: Math.round(r * Math.cos(ang[i]!)), y: Math.round(r * Math.sin(ang[i]!)) }));
  }
  return out;
}

function maxDeviation(specs: PersonSpec[], pos: Map<string, Pt>): number {
  let mx = 0;
  for (const s of specs) {
    const q = pos.get(s.id)!;
    if (s.mag < 0.05 || Math.hypot(q.x, q.y) < 1) continue;
    const d = Math.abs(Math.atan2(Math.sin(Math.atan2(q.y, q.x) - s.theta), Math.cos(Math.atan2(q.y, q.x) - s.theta)));
    mx = Math.max(mx, d);
  }
  return mx;
}

/**
 * Son geçiş (en çok 3 tur, deterministik): bir çizgi başka bir kişinin gövdesini kesiyorsa o kişiyi halkasında çizgiden
 * uzağa 4°'lik adımlarla (hedef açıdan ≤25°) döndürür; olmazsa çizginin sahibini ±20px'e kadar radyal kaydırır.
 * Her adım çakışma ve yabancı altıgen kontrolünden geçmeli ve toplam kesişimi azaltmalıdır.
 */
function refineCrossings(pos: Map<string, Pt>, specs: PersonSpec[], areaPts: LayoutPoint[]): void {
  const byId = new Map(areaPts.map((a) => [a.id, a]));
  const raw = new Map(areaPts.map((a) => [a.id, hexAt(a)]));
  const fat = new Map(areaPts.map((a) => [a.id, hexAt(a, HEX_MARGIN)]));
  const aBoxes = areaPts.map((a) => boxOf(a, NODE_BOX.area));
  const specOf = new Map(specs.map((s) => [s.id, s]));
  const boxAt = (q: Pt) => boxOf({ id: "", ...q }, NODE_BOX.person);
  const linesAt = (id: string, q: Pt) => specOf.get(id)!.areas.map((aid) => ({ aid, ...lineOf(q, byId.get(aid)!, raw.get(aid)!) }));
  const valid = (id: string, q: Pt) => {
    const b = boxAt(q);
    if (aBoxes.some((a) => hit(b, a))) return false;
    for (const [oid, o] of pos) if (oid !== id && hit(b, boxAt(o))) return false;
    for (const l of linesAt(id, q))
      for (const [aid, poly] of fat) if (aid !== l.aid && segHitsPoly(l.start, l.end, poly)) return false;
    return true;
  };
  /** `id` kişisinin q konumunda dâhil olduğu çizgi–gövde kesişim sayısı. */
  const crossings = (id: string, q: Pt) => {
    let c = 0;
    const body = bodyPoly(q);
    for (const l of linesAt(id, q))
      for (const [oid, o] of pos) if (oid !== id && segHitsPoly(l.start, l.end, bodyPoly(o))) c++;
    for (const [oid, o] of pos) {
      if (oid === id) continue;
      for (const l of linesAt(oid, o)) if (segHitsPoly(l.start, l.end, body)) c++;
    }
    return c;
  };
  const step = (4 * Math.PI) / 180;
  const tryMoves = (id: string, moves: Pt[]): boolean => {
    const cur = pos.get(id)!;
    const base = crossings(id, cur);
    for (const q of moves) {
      if (q.x === cur.x && q.y === cur.y) continue;
      if (valid(id, q) && crossings(id, q) < base) {
        pos.set(id, q);
        return true;
      }
    }
    return false;
  };
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (const a of specs) {
      for (const l of linesAt(a.id, pos.get(a.id)!)) {
        for (const b of specs) {
          if (b.id === a.id) continue;
          const bq = pos.get(b.id)!;
          if (!segHitsPoly(l.start, l.end, bodyPoly(bq))) continue;
          const rb = Math.hypot(bq.x, bq.y);
          const phi = Math.atan2(bq.y, bq.x);
          let moved = false;
          if (rb >= 1) {
            // Çizgiden uzaklaşan yön önce.
            const side = (l.end.x - l.start.x) * (bq.y - l.start.y) - (l.end.y - l.start.y) * (bq.x - l.start.x);
            const tang = -Math.sin(phi) * (l.end.y - l.start.y) * -1 + Math.cos(phi) * (l.end.x - l.start.x) * -1;
            const away = side * tang >= 0 ? -1 : 1;
            const moves: Pt[] = [];
            for (let k = 1; k <= 6; k++)
              for (const sg of [away, -away]) {
                const t = phi + sg * k * step;
                if (b.mag >= 0.05 && Math.abs(Math.atan2(Math.sin(t - b.theta), Math.cos(t - b.theta))) > MAX_DEV + 1e-9) continue;
                moves.push({ x: Math.round(rb * Math.cos(t)), y: Math.round(rb * Math.sin(t)) });
              }
            moved = tryMoves(b.id, moves);
          }
          if (!moved) {
            const aq = pos.get(a.id)!;
            const ra = Math.hypot(aq.x, aq.y);
            if (ra >= 1) {
              const moves: Pt[] = [];
              for (let d = 4; d <= 20; d += 4)
                for (const sg of [1, -1]) {
                  const k = Math.max(0, ra + sg * d) / ra;
                  moves.push({ x: Math.round(aq.x * k), y: Math.round(aq.y * k) });
                }
              moved = tryMoves(a.id, moves);
            }
          }
          if (moved) changed = true;
          break;
        }
        // Sahibin konumu değişmiş olabilir; çizgileri yeniden almak için bu kişiyi bırak.
      }
    }
    if (!changed) break;
  }
}

/**
 * `size` yerleşimi etkilemez (imza uyumluluğu). Orijin merkezli, tam sayı koordinat; tuval iki eksende simetrik.
 */
export function layoutLiveMap(map: LiveMap, size?: { width: number; height: number }): LiveMapLayout {
  void size;
  if (map.areas.length === 0 && map.people.length === 0) return { areas: [], people: [], links: [], width: PAD * 2, height: PAD * 2 };
  const { ring1 } = splitRings(map);
  const people = [...map.people].sort(cmp);
  const sortedAreas = [...map.areas].sort(cmp);
  const areaIdx = new Map(sortedAreas.map((a, i) => [a.id, i]));

  const linkedAreas = new Map<string, string[]>();
  for (const l of map.links) {
    if (!areaIdx.has(l.areaId)) continue;
    const a = linkedAreas.get(l.userId) ?? [];
    if (!a.includes(l.areaId)) a.push(l.areaId);
    linkedAreas.set(l.userId, a);
  }
  for (const a of linkedAreas.values()) a.sort((x, y) => areaIdx.get(x)! - areaIdx.get(y)!);

  // Alan halkası-1 açıları R1'den bağımsız (yalnız yön); yön vektörü bir kez hesaplanır.
  const dirOf = new Map(ring1.map((a, i) => [a.id, (i * TAU) / ring1.length]));
  const specs: PersonSpec[] = people.map((p) => {
    const ids = (linkedAreas.get(p.id) ?? []).filter((id) => dirOf.has(id));
    let vx = 0;
    let vy = 0;
    for (const id of ids) {
      const t = dirOf.get(id)!;
      vx += Math.sin(t); // tepeden saat yönü: x = sin, y = -cos
      vy += -Math.cos(t);
    }
    const n = Math.max(1, ids.length);
    vx /= n;
    vy /= n;
    const mag = Math.hypot(vx, vy);
    return { id: p.id, name: p.name, areas: ids, mag: mag < 1e-9 ? 0 : mag, theta: mag < 1e-9 ? 0 : Math.atan2(vy, vx) };
  });
  const nOut = specs.filter((s) => s.mag >= M_SPLIT).length;
  const nMid = specs.length - nOut;
  const need = (n: number) => (n > 1 ? (n * MIN_CHORD) / TAU : 0);

  let R1 = Math.max(chordR(ring1.length), 140);
  let rings = placeAreas(map, R1);
  let pos = new Map<string, Pt>();
  let fallback: { pos: Map<string, Pt>; R1: number; dev: number } | null = null;
  let R1start: number | undefined;
  const person = (q: Pt) => boxOf({ id: "", ...q }, NODE_BOX.person);
  for (let it = 0; it < 80; it++) {
    rings = placeAreas(map, R1);
    const rin = Math.max(0, R1 - HEX_H / 2 - INNER_PAD);
    const cap = R1 - HEX_H / 2 - LABEL_PAD;
    const rMid = Math.max(R_MID * rin, need(nMid));
    let r0 = Math.max(R_OUT * rin, need(nOut));
    if (nOut > 0 && nMid > 0) r0 = Math.max(r0, rMid + RING_GAP);
    R1start ??= R1;
    if (nOut > 0 && r0 > cap) {
      R1 = Math.max(R1 + 24, Math.ceil(r0 + HEX_H / 2 + LABEL_PAD));
      continue;
    }
    const aBoxes = rings.pts.map((a) => boxOf(a, NODE_BOX.area));
    const byId = new Map(rings.pts.map((a) => [a.id, a]));
    const polys = new Map(rings.pts.map((a) => [a.id, hexAt(a, HEX_MARGIN)]));
    let ok: Map<string, Pt> | null = null;
    for (let r = nOut > 0 ? r0 : cap; r <= cap + 1e-9 && !ok; r += 12) {
      const cand = placeRings(specs, { rOut: r, rMid });
      if (!cand) continue;
      const boxes = [...cand.values()].map(person);
      let bad = boxes.some((b) => aBoxes.some((a) => hit(b, a)));
      for (let i = 0; i < boxes.length && !bad; i++) for (let j = i + 1; j < boxes.length && !bad; j++) bad = hit(boxes[i]!, boxes[j]!);
      for (const s of specs) {
        if (bad) break;
        const q = cand.get(s.id)!;
        for (const aid of s.areas) {
          const l = lineOf(q, byId.get(aid)!);
          for (const [id, poly] of polys) if (id !== aid && segHitsPoly(l.start, l.end, poly)) bad = true;
        }
      }
      if (bad) continue;
      const dev = maxDeviation(specs, cand);
      if (!fallback || dev < fallback.dev - 1e-9) fallback = { pos: cand, R1, dev };
      if (dev <= MAX_DEV) ok = cand;
    }
    if (ok) {
      pos = ok;
      break;
    }
    // Sapma 25°'yi aşıyorsa R1 en çok 1.4 katına kadar büyür; sonra en az sapmalı geçerli yerleşim kullanılır.
    if (fallback && R1 >= R1start * 1.4) {
      pos = fallback.pos;
      R1 = fallback.R1;
      rings = placeAreas(map, R1);
      break;
    }
    R1 += 24;
  }
  refineCrossings(pos, specs, rings.pts);
  const personPts: LayoutPoint[] = people.map((p) => ({ id: p.id, x: pos.get(p.id)?.x ?? 0, y: pos.get(p.id)?.y ?? 0 }));
  const areaPtsC = rings.pts;

  const bs = [...areaPtsC.map((a) => boxOf(a, NODE_BOX.area)), ...personPts.map((p) => boxOf(p, NODE_BOX.person))];
  const hw = Math.ceil(Math.max(...bs.map((b) => Math.max(Math.abs(b.x0), Math.abs(b.x1)))) + PAD);
  const hh = Math.ceil(Math.max(...bs.map((b) => Math.max(Math.abs(b.y0), Math.abs(b.y1)))) + PAD);
  const sh = (p: LayoutPoint): LayoutPoint => ({ id: p.id, x: p.x + hw, y: p.y + hh });
  const areasOut = areaPtsC.map(sh);
  const peopleOut = personPts.map(sh);

  const areaPos = new Map(areasOut.map((a) => [a.id, a]));
  const personPos = new Map(peopleOut.map((p) => [p.id, p]));
  const keys = new Map<string, { userId: string; areaId: string }>();
  for (const l of map.links) {
    if (areaPos.has(l.areaId) && personPos.has(l.userId)) keys.set(`${l.userId}|${l.areaId}`, { userId: l.userId, areaId: l.areaId });
  }
  const links: LayoutLink[] = [...keys.keys()].sort().map((key) => {
    const { userId, areaId } = keys.get(key)!;
    const { start, end } = lineOf(personPos.get(userId)!, areaPos.get(areaId)!);
    const s = { x: Math.round(start.x), y: Math.round(start.y) };
    const e = { x: Math.round(end.x), y: Math.round(end.y) };
    return {
      key,
      userId,
      areaId,
      type: "line" as const,
      d: `M${s.x} ${s.y} L${e.x} ${e.y}`,
      pts: [s, e],
      mid: { x: Math.round((s.x + e.x) / 2), y: Math.round((s.y + e.y) / 2) },
    };
  });
  return { areas: areasOut, people: peopleOut, links, width: 2 * hw, height: 2 * hh };
}
