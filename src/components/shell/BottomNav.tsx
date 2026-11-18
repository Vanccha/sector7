"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InstallButton } from "@/components/pwa/InstallButton";
import { formatCount } from "./CountBadge";
import { useCounts } from "./LiveCounts";
import { SignOutButton } from "./SignOutButton";

type Props = { name: string; roles: string; showAreas: boolean; isMainAdmin: boolean };

const ICON = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  "aria-hidden": true,
  focusable: false,
} as const;

function IconHome() {
  return (
    <svg {...ICON}>
      <path d="M4 11l8-7 8 7v9H4z" strokeLinejoin="round" />
    </svg>
  );
}
function IconTicket() {
  return (
    <svg {...ICON}>
      <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" strokeLinejoin="round" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg {...ICON}>
      <path d="M4 5h16v11H9l-5 4z" strokeLinejoin="round" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg {...ICON}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7z" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}
function IconMenu() {
  return (
    <svg {...ICON}>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

/** ≤ 720px: sabit alt sekme çubuğu + "Menü" alt sayfası. Rozetler LiveCounts bağlamından gelir. */
export function BottomNav({ name, roles, showAreas, isMainAdmin }: Props) {
  const path = usePathname();
  const { messages, notifications } = useCounts();
  const [open, setOpen] = useState(false);
  const [seenPath, setSeenPath] = useState(path);
  const sheetRef = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);

  // Sayfa değişince alt sayfayı kapat.
  if (seenPath !== path) {
    setSeenPath(path);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>("a,button")?.focus();
    const btn = menuBtn.current;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !sheet) return;
      const f = Array.from(sheet.querySelectorAll<HTMLElement>("a,button:not(:disabled)"));
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      btn?.focus();
    };
  }, [open]);

  const item = (href: string, label: string, icon: React.ReactNode, count = 0) => {
    const active = href === "/" ? path === "/" : path.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className="bottom-nav__item"
        aria-current={active ? "page" : undefined}
        aria-label={count > 0 ? `${label}, ${count} okunmamış` : undefined}
      >
        <span className="bottom-nav__icon">
          {icon}
          {count > 0 && (
            <span className="bottom-nav__badge" aria-hidden="true">
              {formatCount(count)}
            </span>
          )}
        </span>
        {label}
      </Link>
    );
  };

  return (
    <>
      <nav className="bottom-nav" aria-label="Mobil gezinme">
        {item("/", "Ana sayfa", <IconHome />)}
        {item("/ticketlarim", "Ticket'larım", <IconTicket />)}
        {item("/mesajlar", "Mesajlar", <IconChat />, messages)}
        {item("/bildirimler", "Bildirimler", <IconBell />, notifications)}
        <button
          ref={menuBtn}
          type="button"
          className="bottom-nav__item"
          aria-expanded={open}
          aria-controls="menu-sheet"
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="bottom-nav__icon">
            <IconMenu />
          </span>
          Menü
        </button>
      </nav>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={sheetRef} id="menu-sheet" className="menu-sheet" role="dialog" aria-modal="true" aria-label="Menü">
            <div className="menu-sheet__head">
              <span className="menu-sheet__who">
                <strong>{name}</strong>
                <small>{roles}</small>
              </span>
              <button type="button" className="btn-line" onClick={() => setOpen(false)}>
                Kapat
              </button>
            </div>
            <Link href="/profil" className="menu-sheet__link" aria-current={path.startsWith("/profil") ? "page" : undefined}>
              Profil
            </Link>
            <Link href="/sema" className="menu-sheet__link" aria-current={path.startsWith("/sema") ? "page" : undefined}>
              Şema
            </Link>
            {showAreas && (
              <Link href="/alan" className="menu-sheet__link" aria-current={path.startsWith("/alan") ? "page" : undefined}>
                Alanlarım
              </Link>
            )}
            {isMainAdmin && (
              <Link href="/yonetim" className="menu-sheet__link" aria-current={path.startsWith("/yonetim") ? "page" : undefined}>
                Yönetim
              </Link>
            )}
            <Link
              href="/bildirimler/tercihler"
              className="menu-sheet__link"
              aria-current={path.startsWith("/bildirimler/tercihler") ? "page" : undefined}
            >
              Bildirim tercihleri
            </Link>
            <InstallButton variant="menu" />
            <div className="menu-sheet__out">
              <SignOutButton />
            </div>
          </div>
        </>
      )}
    </>
  );
}
