import Link from "next/link";
import { Suspense } from "react";
import type { Actor } from "@/lib/contracts/actor";
import { rolesOf, ROLE_LABELS } from "@/lib/contracts/actor";
import type { SprintView } from "@/lib/current-sprint";
import { BellLink } from "./BellLink";
import { InstallButton } from "@/components/pwa/InstallButton";
import { BottomNav } from "./BottomNav";
import { Brand } from "./Brand";
import { NavLinks, type NavItem } from "./NavLinks";
import { SignOutButton } from "./SignOutButton";
import { SprintStatus } from "./SprintStatus";

export function navFor(actor: Actor): NavItem[] {
  const items: NavItem[] = [
    { href: "/", label: "Ana sayfa" },
    { href: "/sema", label: "Şema" },
    { href: "/ticketlarim", label: "Ticket'larım" },
    { href: "/mesajlar", label: "Mesajlar", badge: "messages" },
  ];
  if (actor.isMainAdmin || actor.managedAreaIds.length > 0) items.push({ href: "/alan", label: "Alanlarım" });
  if (actor.isMainAdmin) items.push({ href: "/yonetim", label: "Yönetim" });
  return items;
}

/** Uygulama başlığı + mobil alt sekme çubuğu. Masaüstünde üst sekmeler, ≤ 720px'te alt çubuk. */
export function AppHeader({ actor, sprint }: { actor: Actor; sprint: SprintView | null }) {
  const roles = rolesOf(actor)
    .map((r) => ROLE_LABELS[r])
    .join("\u2002·\u2002");
  return (
    <>
      <header className="app-header">
        <div className="app-header__top">
          <Brand />
          <div className="app-header__user">
            <InstallButton variant="header" />
            <BellLink />
            <Link
              href="/profil"
              className="app-header__who"
              style={{ color: "inherit", textDecoration: "none", minHeight: 44, justifyContent: "center" }}
              aria-label={`Profil: ${actor.name}`}
            >
              <span style={{ fontWeight: 600 }}>{actor.name}</span>
              <small>{roles}</small>
            </Link>
            <SignOutButton />
          </div>
        </div>
        <SprintStatus sprint={sprint} />
        <div className="app-header__nav">
          <Suspense>
            <NavLinks items={navFor(actor)} />
          </Suspense>
        </div>
      </header>
      <BottomNav
        name={actor.name}
        roles={roles}
        showAreas={actor.isMainAdmin || actor.managedAreaIds.length > 0}
        isMainAdmin={actor.isMainAdmin}
      />
    </>
  );
}
