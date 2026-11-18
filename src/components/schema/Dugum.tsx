import type { CSSProperties } from "react";
import { DEFAULT_NODE_SHAPE, type NodeShape } from "@/lib/contracts/live-map";
import styles from "./Dugum.module.css";

/**
 * Şema düğümü — tek bileşen. Şekli değiştirmek için `shape` prop'u (ya da sözleşmedeki DEFAULT_NODE_SHAPE).
 * Yeni şekil eklemek: NodeShape'e ekle + aşağıdaki SHAPES'e poligon yaz.
 * Yalnız "span" üretir; bir <button> içine konabilir. Etkileşim ve durum (hover/odak) kapsayandadır.
 */
export const SHAPES: Record<NodeShape, { polygon: string; labelY: "mid" | "low" }> = {
  // Kesik köşeli altıgen: uç köşeleri hafif kesik.
  hex: { polygon: "polygon(25% 0, 75% 0, 98% 40%, 98% 60%, 75% 100%, 25% 100%, 2% 60%, 2% 40%)", labelY: "mid" },
  // Referanstaki üçgen.
  tri: { polygon: "polygon(50% 0, 100% 100%, 0 100%)", labelY: "low" },
  // İki köşesi (sağ üst, sol alt) kesik kare.
  "cut-square": { polygon: "polygon(0 0, 78% 0, 100% 22%, 100% 100%, 22% 100%, 0 78%)", labelY: "mid" },
};

/** Gövde ölçüleri (px) — yerleşim bunları kullanır. */
export const NODE_SIZES = {
  area: { w: 108, h: 94 },
  person: { w: 60, h: 52 },
} as const;

type Props = {
  shape?: NodeShape;
  size: "area" | "person";
  /** İç metin: alan için kısaltma, kişi için baş harfler. */
  label: string;
  /** Şu an iş var (kenar rengi vurgulu). */
  active?: boolean;
  /** Odak/seçim vurgusu. */
  selected?: boolean;
  /** Soluk (başka bir düğüm odakta). */
  dim?: boolean;
  /** Altta ad. */
  title?: string;
  /** Altta rol / sayı. */
  sub?: string;
};

export function Dugum({ shape = DEFAULT_NODE_SHAPE, size, label, active, selected, dim, title, sub }: Props) {
  const s = SHAPES[shape];
  const { w, h } = NODE_SIZES[size];
  const style = { "--poly": s.polygon, width: w, height: h } as CSSProperties;
  const cls = [styles.dugum, active ? styles.active : "", selected ? styles.selected : "", dim ? styles.dim : ""].join(" ");
  return (
    <span className={cls} data-size={size}>
      <span className={styles.wrap} style={style}>
        <span className={styles.edge} />
        <span className={styles.body}>
          <span className={`${styles.initials} ${s.labelY === "low" ? styles.low : ""}`}>{label}</span>
        </span>
      </span>
      {(title || sub) && (
        <span className={styles.meta}>
          {title && <span className={styles.name}>{title}</span>}
          {sub && <span className={styles.role}>{sub}</span>}
        </span>
      )}
    </span>
  );
}
