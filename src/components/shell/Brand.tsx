import Link from "next/link";

/** AllSpark işareti (logo görselindeki üçgen işaret, vektör olarak çizildi, arka plansız); renkler temadan gelir. */
export function Mark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 228) / 268} viewBox="404 304 268 228" aria-hidden="true" focusable="false">
      <polygon points="512,346 603,504 656,504 668,527 591,527 512,390 459,481 434,481" style={{ fill: "var(--mk1)" }} />
      <polygon points="540,309 643,490 617,490 527,332" style={{ fill: "var(--mk2)" }} />
      <polygon points="513,437 526,459 487,527 409,527 421,504 474,504" style={{ fill: "var(--tx)" }} />
    </svg>
  );
}

/** İşaret + ALLSPARK (ALL kırmızı, SPARK beyaz) + BETA etiketi. `stacked`: logodaki gibi işaret üstte, yazı altta, ortalı ve simetrik. Başlıkta dar ekranda yalnız işaret ve BETA görünür. */
export function Brand({ href = "/", stacked = false }: { href?: string; stacked?: boolean }) {
  return (
    <Link href={href} className={stacked ? "brand brand--stacked" : "brand"} aria-label="AllSpark, ana sayfa">
      <Mark size={stacked ? 64 : 36} />
      <span className="wordmark" aria-hidden="true">
        <span className="wordmark__all">ALL</span>
        <span className="wordmark__spark">SPARK</span>
      </span>
      <span className="beta-tag">BETA</span>
    </Link>
  );
}
