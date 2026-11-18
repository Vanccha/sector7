"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCount } from "./CountBadge";
import { useCounts } from "./LiveCounts";

/** Sağ üstteki zil: /bildirimler bağlantısı + okunmamış sayısı. */
export function BellLink() {
  const { notifications: n } = useCounts();
  const path = usePathname();
  return (
    <Link
      href="/bildirimler"
      aria-label={`Bildirimler, ${n} okunmamış`}
      aria-current={path.startsWith("/bildirimler") ? "page" : undefined}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 44,
        minHeight: 44,
        color: n > 0 ? "var(--ac-tx)" : "var(--mut)",
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7z" strokeLinejoin="round" />
        <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
      </svg>
      {n > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 4,
            right: 2,
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            background: "var(--hot)",
            color: "var(--on-hot)",
            clipPath: "polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))",
          }}
        >
          {formatCount(n)}
        </span>
      )}
    </Link>
  );
}
