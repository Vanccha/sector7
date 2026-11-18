import { ImageResponse } from "next/og";

// tokens.css (mavi tema) karşılıkları; ImageResponse CSS değişkeni okuyamaz.
const BG = "#070915";
const MK1 = "#2b3fd1";
const MK2 = "#d21f14";
const TX = "#e8e9f3";
const EDGE = "#1e2b93";

/** AllSpark işareti (Brand.tsx Mark ile aynı poligonlar) koyu zeminde. `safe`: işaretin kapladığı oran. */
export function renderIcon(px: number, opts: { safe?: number; frame?: boolean } = {}) {
  const safe = opts.safe ?? 0.62;
  const w = px * safe;
  const h = (w * 76) / 100;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
        }}
      >
        {opts.frame ? (
          <div
            style={{
              position: "absolute",
              top: px * 0.08,
              left: px * 0.08,
              right: px * 0.08,
              bottom: px * 0.08,
              border: `${Math.max(2, px * 0.012)}px solid ${EDGE}`,
              display: "flex",
            }}
          />
        ) : null}
        <svg width={w} height={h} viewBox="0 0 100 76">
          <polygon points="40,6 52,6 84,74 70,74 46,24 34,48 20,48" fill={MK1} />
          <polygon points="56,0 66,0 100,74 90,74" fill={MK2} />
          <polygon points="22,48 34,48 24,70 4,70 8,62 18,62" fill={TX} />
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}
