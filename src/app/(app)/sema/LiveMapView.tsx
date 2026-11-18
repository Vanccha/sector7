"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dugum, NODE_SIZES } from "@/components/schema/Dugum";
import { useLiveEvents } from "@/components/realtime/live";
import type { LiveMap, LiveMapLink } from "@/lib/contracts/live-map";
import { layoutLiveMap } from "@/lib/live-map-layout";
import styles from "./sema.module.css";

type Focus = { kind: "area" | "person"; id: string } | null;
type Pair = { key: string; userId: string; areaId: string; links: LiveMapLink[]; allPaused: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function initialsOf(name: string, max = 2): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const chars =
    parts.length > 1 ? parts.slice(0, max).map((p) => [...p][0]) : [...(parts[0] ?? "")].slice(0, max);
  return chars.join("").toLocaleUpperCase("tr");
}

/** Noktanın (px,py) doğru parçasına (x0,y0)-(x1,y1) uzaklığı. */
function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = clamp(((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Kişi → alan şimşeği: iki uç arasında deterministik zikzak yol. */
function zigzag(x0: number, y0: number, x1: number, y1: number): string {
  const N = 9;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`;
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const off = (i % 2 ? 1 : -1) * 11;
    d += ` L${(x0 + dx * t + nx * off).toFixed(1)} ${(y0 + dy * t + ny * off).toFixed(1)}`;
  }
  return `${d} L${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
/** Hedef altıgen flaşı için çokgen (Dugum `hex` şekliyle aynı oranlar), merkeze göre. */
const HEX_FLASH = [[-40, -70], [40, -70], [78.4, -14], [78.4, 14], [40, 70], [-40, 70], [-78.4, 14], [-78.4, -14]]
  .map(([x, y]) => `${x},${y}`)
  .join(" ");

function TicketList({ links }: { links: LiveMapLink[] }) {
  return (
    <ul className={styles.tickets}>
      {links.map((l) => (
        <li key={l.ticketId}>
          <span>{l.title}</span>
          {l.paused && <span className={styles.tag}>duraklatıldı</span>}
        </li>
      ))}
    </ul>
  );
}

export function LiveMapView({ map }: { map: LiveMap }) {
  const router = useRouter();

  // Canlılık: ticket/yeniden bağlanma olaylarında ~1 sn debounce ile yenile.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents((e) => {
    if (e.kind !== "tickets" && e.kind !== "ready") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 1000);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Masaüstü tuval genişliği.
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Yeni bağlantı şimşeği: yalnız canlı güncellemede (ilk yüklemede değil); azaltılmış harekette CSS göstermez.
  const [bolts, setBolts] = useState<string[]>([]);
  const prevKeys = useRef<Set<string> | null>(null);
  const boltTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hover, setHover] = useState<Focus>(null);
  const [sel, setSel] = useState<Focus>(null);

  const areaById = useMemo(() => new Map(map.areas.map((a) => [a.id, a])), [map.areas]);
  const personById = useMemo(() => new Map(map.people.map((p) => [p.id, p])), [map.people]);

  const pairs = useMemo(() => {
    const byKey = new Map<string, Pair>();
    for (const l of map.links) {
      if (!areaById.has(l.areaId) || !personById.has(l.userId)) continue;
      const key = `${l.userId}|${l.areaId}`;
      const p = byKey.get(key) ?? { key, userId: l.userId, areaId: l.areaId, links: [], allPaused: true };
      p.links.push(l);
      if (!l.paused) p.allPaused = false;
      byKey.set(key, p);
    }
    return [...byKey.values()];
  }, [map.links, areaById, personById]);

  useEffect(() => {
    const cur = new Set(pairs.map((p) => p.key));
    const prev = prevKeys.current;
    prevKeys.current = cur;
    if (!prev) return;
    const fresh = [...cur].filter((k) => !prev.has(k));
    if (fresh.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setBolts(fresh);
    if (boltTimer.current) clearTimeout(boltTimer.current);
    boltTimer.current = setTimeout(() => setBolts([]), 900);
  }, [pairs]);
  useEffect(
    () => () => {
      if (boltTimer.current) clearTimeout(boltTimer.current);
    },
    [],
  );

  const layout = useMemo(() => layoutLiveMap(map), [map]);
  // Kap genişliğine sığdır (büyütme yok, alt sınır 0.5; altında kaydırma).
  const scale = clamp(width / layout.width, 0.5, 1);
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const a of layout.areas) m.set(`area:${a.id}`, a);
    for (const p of layout.people) m.set(`person:${p.id}`, p);
    return m;
  }, [layout]);

  const focus = hover ?? sel;
  const related = useMemo(() => {
    if (!focus) return null;
    const nodes = new Set<string>([`${focus.kind}:${focus.id}`]);
    const edges = new Set<string>();
    for (const p of pairs) {
      if ((focus.kind === "area" ? p.areaId : p.userId) !== focus.id) continue;
      edges.add(p.key);
      nodes.add(`area:${p.areaId}`);
      nodes.add(`person:${p.userId}`);
    }
    return { nodes, edges };
  }, [focus, pairs]);

  const detail = sel ?? hover;
  const toggle = (f: NonNullable<Focus>) =>
    setSel((s) => (s && s.kind === f.kind && s.id === f.id ? null : f));

  const nodeProps = (kind: "area" | "person", id: string) => ({
    onMouseEnter: () => setHover({ kind, id }),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover({ kind, id }),
    onBlur: () => setHover(null),
    onClick: () => toggle({ kind, id }),
  });

  const activeAreas = new Set(pairs.map((p) => p.areaId));
  const activePeople = new Set(pairs.map((p) => p.userId));

  // Mobil liste: çalışan olan alanlar önde, boşlar en altta.
  const mobileAreas = useMemo(() => {
    const withWork = map.areas.filter((a) => pairs.some((p) => p.areaId === a.id));
    const empty = map.areas.filter((a) => !pairs.some((p) => p.areaId === a.id));
    return [...withWork, ...empty];
  }, [map.areas, pairs]);

  const detailArea = detail?.kind === "area" ? areaById.get(detail.id) : undefined;
  const detailPerson = detail?.kind === "person" ? personById.get(detail.id) : undefined;
  const detailPairs = detail ? pairs.filter((p) => (detail.kind === "area" ? p.areaId : p.userId) === detail.id) : [];

  return (
    <>
      <div className={styles.status} aria-live="polite">
        <span className={styles.live}>
          <span className={styles.dot} aria-hidden="true" />
          Canlı
        </span>
        <span className={styles.stat}>
          <b>{map.people.length}</b> kişi çalışıyor
        </span>
        <span className={styles.stat}>
          <b>{map.links.length}</b> ticket sürüyor
        </span>
      </div>

      {map.links.length === 0 && (
        <p className="empty-state" style={{ margin: 0 }}>
          Şu an sürmekte olan ticket yok. Biri bir ticket üstlendiğinde burada görünecek.
        </p>
      )}

      {/* Masaüstü */}
      <div className={`page-split ${styles.desktop}`}>
        <div className="page-split__main">
          <div className={styles.scroller} ref={hostRef}>
            <div className={styles.stage} style={{ width: layout.width * scale, height: layout.height * scale }}>
            <div
              className={styles.canvas}
              style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
            >
              <svg className={styles.edges} width={layout.width} height={layout.height} aria-hidden="true">
                {pairs.map((p) => {
                  const a = pos.get(`area:${p.areaId}`);
                  const q = pos.get(`person:${p.userId}`);
                  if (!a || !q) return null;
                  const on = !related || related.edges.has(p.key);
                  const fade = on ? "" : styles.faded;
                  return (
                    <g key={p.key}>
                      <line className={`${styles.base} ${fade}`} x1={q.x} y1={q.y} x2={a.x} y2={a.y} vectorEffect="non-scaling-stroke" />
                      <line
                        className={`${p.allPaused ? styles.paused : styles.flow} ${fade}`}
                        x1={q.x}
                        y1={q.y}
                        x2={a.x}
                        y2={a.y}
                        vectorEffect="non-scaling-stroke"
                      />
                      {p.links.length > 1 && (
                        <g className={on ? "" : styles.faded} transform={`translate(${(q.x + a.x) / 2} ${(q.y + a.y) / 2})`}>
                          <circle r="11" className={styles.badge} />
                          <text className={styles.badgeTx} textAnchor="middle" dominantBaseline="central">
                            {p.links.length}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
              {map.areas.map((a) => {
                const pt = pos.get(`area:${a.id}`);
                if (!pt) return null;
                const key = `area:${a.id}`;
                const count = pairs.filter((p) => p.areaId === a.id).reduce((s, p) => s + p.links.length, 0);
                return (
                  <button
                    key={key}
                    type="button"
                    className={styles.node}
                    style={{ left: pt.x, top: pt.y, width: NODE_SIZES.area.w, marginTop: -NODE_SIZES.area.h / 2 }}
                    aria-pressed={sel?.kind === "area" && sel.id === a.id}
                    aria-label={`${a.name} alanı, ${count} ticket sürüyor`}
                    {...nodeProps("area", a.id)}
                  >
                    <Dugum
                      size="area"
                      label={initialsOf(a.name, 3)}
                      active={activeAreas.has(a.id)}
                      selected={focus?.kind === "area" && focus.id === a.id}
                      dim={!!related && !related.nodes.has(key)}
                    >
                      <span className={styles.areaName} title={a.name}>
                        {a.name}
                      </span>
                      <span className={styles.areaMgr}>{a.managerName ?? "yönetici yok"}</span>
                      <span className={`${styles.areaBadge} ${count > 0 ? styles.areaBadgeOn : ""}`}>
                        {count > 0 ? `${count} ticket` : "boş"}
                      </span>
                    </Dugum>
                  </button>
                );
              })}
              {map.people.map((p) => {
                const pt = pos.get(`person:${p.id}`);
                if (!pt) return null;
                const key = `person:${p.id}`;
                const count = pairs.filter((x) => x.userId === p.id).reduce((s, x) => s + x.links.length, 0);
                return (
                  <button
                    key={key}
                    type="button"
                    className={styles.node}
                    style={{ left: pt.x, top: pt.y, width: 112, marginTop: -NODE_SIZES.person.h / 2 }}
                    aria-pressed={sel?.kind === "person" && sel.id === p.id}
                    aria-label={`${p.name}, ${count} ticket üzerinde çalışıyor`}
                    {...nodeProps("person", p.id)}
                  >
                    <Dugum
                      size="person"
                      label={initialsOf(p.name)}
                      active={activePeople.has(p.id)}
                      selected={focus?.kind === "person" && focus.id === p.id}
                      dim={!!related && !related.nodes.has(key)}
                      title={p.name}
                    />
                  </button>
                );
              })}
              {/* Başka bir alanın altıgeninin altından geçen bağlantılar: düğümlerin üstünde ince, yarı saydam */}
              <svg className={styles.overLayer} width={layout.width} height={layout.height} aria-hidden="true">
                {pairs.map((p) => {
                  const a = pos.get(`area:${p.areaId}`);
                  const q = pos.get(`person:${p.userId}`);
                  if (!a || !q) return null;
                  const crosses = layout.areas.some((o) => o.id !== p.areaId && segDist(o.x, o.y, q.x, q.y, a.x, a.y) < 66);
                  if (!crosses) return null;
                  const on = !related || related.edges.has(p.key);
                  return <line key={p.key} className={`${styles.over} ${on ? "" : styles.faded}`} x1={q.x} y1={q.y} x2={a.x} y2={a.y} />;
                })}
              </svg>
              <svg className={styles.fxLayer} width={layout.width} height={layout.height} aria-hidden="true" focusable="false">
                {pairs
                  .filter((p) => bolts.includes(p.key))
                  .map((p) => {
                    const a = pos.get(`area:${p.areaId}`);
                    const q = pos.get(`person:${p.userId}`);
                    if (!a || !q) return null;
                    const d = zigzag(q.x, q.y, a.x, a.y);
                    return (
                      <g key={p.key} className={styles.boltOn}>
                        <path d={d} pathLength={1} className={styles.boltGlow} />
                        <path d={d} pathLength={1} className={styles.boltLine} />
                        <g transform={`translate(${a.x} ${a.y})`}>
                          <polygon points={HEX_FLASH} className={styles.flash} />
                        </g>
                      </g>
                    );
                  })}
              </svg>
            </div>
            </div>
          </div>
        </div>
        <aside className={`page-split__side`} aria-label="Ayrıntı">
          <section className="cut-panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 className="panel-h">{detailArea?.name ?? detailPerson?.name ?? "Ayrıntı"}</h2>
            {!detail || (!detailArea && !detailPerson) ? (
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Bir düğüm seç: alanın ya da kişinin ticket başlıkları burada listelenir.
              </p>
            ) : detailPairs.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Şu an kimse yok.
              </p>
            ) : (
              <ul className={styles.detailList}>
                {detailPairs.map((p) => (
                  <li key={p.key}>
                    <span className={styles.who}>
                      {detail.kind === "area" ? personById.get(p.userId)?.name : areaById.get(p.areaId)?.name}
                    </span>
                    <TicketList links={p.links} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* Mobil */}
      <section className={styles.mobile} aria-labelledby="sema-alanlar">
        <h2 className="sr-only" id="sema-alanlar">
          Alanlar
        </h2>
        <ul className={styles.cards}>
          {mobileAreas.map((a) => {
            const ap = pairs.filter((p) => p.areaId === a.id);
            const count = ap.reduce((s, p) => s + p.links.length, 0);
            return (
              <li key={a.id} className={`cut-panel ${styles.card} ${ap.length === 0 ? styles.cardEmpty : ""}`}>
                <div className={styles.cardHead}>
                  <span aria-hidden="true">
                    <Dugum size="person" label={initialsOf(a.name, 3)} active={ap.length > 0} />
                  </span>
                  <div>
                    <h3 className={styles.cardTitle}>{a.name}</h3>
                    <span className={styles.cardMgr}>{a.managerName ? `Yönetici: ${a.managerName}` : "Yönetici yok"}</span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {count > 0 ? `${count} ticket sürüyor` : "Şu an kimse yok"}
                    </span>
                  </div>
                </div>
                {ap.length > 0 && (
                  <ul className={styles.detailList}>
                    {ap.map((p) => (
                      <li key={p.key}>
                        <span className={styles.who}>{personById.get(p.userId)?.name}</span>
                        <TicketList links={p.links} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
