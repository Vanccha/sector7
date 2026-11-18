"use client";
import { useCounts } from "./LiveCounts";

export function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

const style: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  marginLeft: 6,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  background: "var(--hot)",
  color: "var(--on-hot)",
  fontVariantNumeric: "tabular-nums",
  clipPath: "polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))",
};

/** Mesajlar sekmesindeki okunmamış sayısı; 0 ise görünmez. */
export function MessageBadge() {
  const { messages } = useCounts();
  if (messages <= 0) return null;
  return (
    <span style={style} aria-label={`${messages} okunmamış`}>
      {formatCount(messages)}
    </span>
  );
}
