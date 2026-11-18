import Link from "next/link";

/** AllSpark işareti (referanstaki SVG); renkler temadan gelir. */
export function Mark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 76) / 100} viewBox="0 0 100 76" aria-hidden="true" focusable="false">
      <polygon points="40,6 52,6 84,74 70,74 46,24 34,48 20,48" style={{ fill: "var(--mk1)" }} />
      <polygon points="56,0 66,0 100,74 90,74" style={{ fill: "var(--mk2)" }} />
      <polygon points="22,48 34,48 24,70 4,70 8,62 18,62" style={{ fill: "var(--tx)" }} />
    </svg>
  );
}

/** İşaret + ALLSPARK + BETA etiketi. Başlıkta dar ekranda yalnız işaret ve BETA görünür. */
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="AllSpark, ana sayfa">
      <Mark size={36} />
      <span className="wordmark" aria-hidden="true">
        ALLSPARK
      </span>
      <span className="beta-tag">BETA</span>
    </Link>
  );
}
