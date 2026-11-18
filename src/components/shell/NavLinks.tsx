"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type NavItem = { href: string; label: string; exact?: boolean };

/**
 * Sekme bağlantıları. `keepQuery` verilirse o sorgu parametreleri (ör. "sprint") bağlantılara taşınır.
 */
export function NavLinks({
  items,
  label = "Ana gezinme",
  keepQuery = [],
}: {
  items: NavItem[];
  label?: string;
  keepQuery?: string[];
}) {
  const path = usePathname();
  const sp = useSearchParams();
  const qs = new URLSearchParams();
  for (const k of keepQuery) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs}` : "";
  return (
    <nav aria-label={label} style={{ display: "flex", gap: 24, overflowX: "auto" }}>
      {items.map((it) => {
        const active = it.exact || it.href === "/" ? path === it.href : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={`${it.href}${suffix}`}
            className="nav-link"
            aria-current={active ? "page" : undefined}
            style={{ whiteSpace: "nowrap" }}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
