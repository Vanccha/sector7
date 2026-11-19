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
 * C) Kişiler (tek aktif ticket kuralı, 2026-11-19: her kişi tek alana bağlı): kendi alanının hemen iç tarafında, alan ile
 *    merkez arasında; aynı alandakiler teğet yönde simetrik bir sıra, sığmazsa içeri doğru yeni sıra. Çakışma ya da yabancı
 *    altıgen kesişimi olursa R1 büyür. (Eski veride birden çok bağlantısı olan kişi halkada ilk alanının önüne konur.)
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
/** R1 başlangıcı için kaba kişi sırası derinliği (alan merkezinden ilk sıraya, sıralar arası). */
const FRONT = HEX_H / 2 + 62 + 16;
const ROW_H = 104;
/** Kişi sırası alanın açı diliminden bu kat geniş olabilir (komşu dilime taşma; çakışma denetimi korur). */
const FAN = 1.6;
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

/** Çizgi: kişi merkezinden hedef altıgenin en yakın kenar noktasına; başlangıç gövde kenarında. */
function lineOf(q: Pt, c: Pt, poly: Pt[] = hexAt(c)): { start: Pt; end: Pt } {
  const end = nearestOnPoly(poly, q);
  const len = Math.hypot(end.x - q.x, end.y - q.y) || 1;
  return { start: { x: q.x + ((end.x - q.x) / len) * PERSON_R, y: q.y + ((end.y - q.y) / len) * PERSON_R }, end };
}

/**
 * Eksene hizalı kutuları (x'te `gx`, y'de `gy` en az aralık) (dx, dy) birim yönünde ayıran en kısa adım: kutular
 * eksenlerden birinde ayrılınca yeter.
 */
const stepAlong = (dx: number, dy: number, gx: number, gy: number) =>
  Math.min(Math.abs(dx) > 1e-9 ? gx / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? gy / Math.abs(dy) : Infinity);
const PB = NODE_BOX.person;
const AB = NODE_BOX.area;

/** Her alanın kişileri (ad sırasıyla) alanın iç tarafında, teğet yönde simetrik sıralar hâlinde. */
function placePeople(groups: Map<string, string[]>, areaPts: LayoutPoint[], n1: number): Map<string, Pt> {
  const out = new Map<string, Pt>();
  for (const a of areaPts.slice(0, n1)) {
    const ids = groups.get(a.id);
    if (!ids?.length) continue;
    const R = Math.hypot(a.x, a.y);
    const ux = R > 0 ? -a.x / R : 0; // içeri (merkeze) birim vektör
    const uy = R > 0 ? -a.y / R : 1;
    const tx = -uy; // teğet
    const ty = ux;
    // Alan kutusundan ilk sıraya, sıralar arası ve sıra içi aralıklar yöne göre (kutular eksene hizalı).
    // G: çakışma testi en az SEP boşluk ister; yuvarlama ve eğik yön için ek pay.
    const G = SEP + 4;
    const front = stepAlong(ux, uy, AB.r + PB.l + G, uy > 0 ? AB.b + PB.t + G : AB.t + PB.b + G);
    const rowStep = stepAlong(ux, uy, PB.l + PB.r + G, PB.t + PB.b + G);
    const colStep = stepAlong(tx, ty, PB.l + PB.r + G, PB.t + PB.b + G);
    const sector = n1 < 2 ? Infinity : FAN * 2 * Math.max(0, R - front) * Math.sin(Math.PI / n1);
    const cap = Math.max(1, Math.min(ids.length, Math.floor(sector / colStep)));
    ids.forEach((id, j) => {
      const row = Math.floor(j / cap);
      const inRow = Math.min(cap, ids.length - row * cap);
      const off = (j - row * cap - (inRow - 1) / 2) * colStep;
      // Sıranın yanlarındaki kişi eğik yönde alana yaklaşabilir: kendi alanından ayrılana kadar içeri it.
      const aBox = boxOf(a, AB);
      let d = front + row * rowStep;
      let q = { x: Math.round(a.x + ux * d + tx * off), y: Math.round(a.y + uy * d + ty * off) };
      while (hit(boxOf({ id, ...q }, PB), aBox)) {
        d += 4;
        q = { x: Math.round(a.x + ux * d + tx * off), y: Math.round(a.y + uy * d + ty * off) };
      }
      out.set(id, q);
    });
  }
  return out;
}

/**
 * `size` yerleşimi etkilemez (imza uyumluluğu). Orijin merkezli, tam sayı koordinat; tuval iki eksende simetrik.
 */
export function layoutLiveMap(map: LiveMap, size?: { width: number; height: number }): LiveMapLayout {
  void size;
  if (map.areas.length === 0 && map.people.length === 0) return { areas: [], people: [], links: [], width: PAD * 2, height: PAD * 2 };
  const { ring1 } = splitRings(map);
  const people = [...map.people].sort(cmp);
  const ringIdx = new Map(ring1.map((a, i) => [a.id, i]));
  // Kişinin alanı: halka-1'deki bağlı alanlardan sıraca ilki (tek ticket kuralıyla zaten tek alan).
  const areaOf = new Map<string, string>();
  for (const l of map.links) {
    const cur = areaOf.get(l.userId);
    if (ringIdx.has(l.areaId) && (cur === undefined || ringIdx.get(l.areaId)! < ringIdx.get(cur)!)) areaOf.set(l.userId, l.areaId);
  }
  const groups = new Map<string, string[]>();
  for (const p of people) {
    const aid = areaOf.get(p.id);
    if (aid) groups.set(aid, [...(groups.get(aid) ?? []), p.id]);
  }
  const maxGroup = Math.max(0, ...[...groups.values()].map((g) => g.length));

  // Kalabalık alanın kişileri (en çok 4) tek sırada yan yana sığsın: sıra genişliği ≤ alanın sektör kirişi.
  const perRow = Math.min(4, maxGroup);
  const rowFit = ring1.length < 2 ? 0 : FRONT + (perRow * (NODE_BOX.person.l + NODE_BOX.person.r + 12)) / (FAN * 2 * Math.sin(Math.PI / ring1.length));
  let R1 = Math.max(chordR(ring1.length), 140, rowFit, FRONT + Math.ceil(maxGroup / 4) * ROW_H);
  let rings = placeAreas(map, R1);
  let pos = new Map<string, Pt>();
  for (let it = 0; it < 80; it++) {
    rings = placeAreas(map, R1);
    pos = placePeople(groups, rings.pts, rings.ring1);
    const cand = { areas: rings.pts, people: [...pos].map(([id, q]) => ({ id, ...q })) };
    const crosses = map.links.some((l) => {
      const q = pos.get(l.userId);
      const a = rings.pts.find((x) => x.id === l.areaId);
      if (!q || !a) return false;
      const { start, end } = lineOf(q, a);
      return linkCrossesForeignHex(cand, { areaId: l.areaId, pts: [start, end] });
    });
    if (!layoutHasOverlap(cand) && !crosses) break;
    R1 += 24;
  }
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
