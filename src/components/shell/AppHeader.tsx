import { Suspense } from "react";
import type { Actor } from "@/lib/contracts/actor";
import { rolesOf, ROLE_LABELS } from "@/lib/contracts/actor";
import type { SprintView } from "@/lib/current-sprint";
import { Brand } from "./Brand";
import { NavLinks, type NavItem } from "./NavLinks";
import { SignOutButton } from "./SignOutButton";
import { SprintStatus } from "./SprintStatus";

export function navFor(actor: Actor): NavItem[] {
  const items: NavItem[] = [{ href: "/", label: "Ana sayfa" }, { href: "/ticketlarim", label: "Ticket'larım" }];
  if (actor.isMainAdmin || actor.managedAreaIds.length > 0) items.push({ href: "/alan", label: "Alanlarım" });
  if (actor.isMainAdmin) items.push({ href: "/yonetim", label: "Yönetim" });
  return items;
}

/** Uygulama başlığı: marka + BETA, sprint durumu, gezinme, kişi. Mobil önce. */
export function AppHeader({ actor, sprint }: { actor: Actor; sprint: SprintView | null }) {
  const roles = rolesOf(actor)
    .map((r) => ROLE_LABELS[r])
    .join(" · ");
  return (
    <header
      style={{
        borderBottom: "1px solid var(--line)",
        padding: "12px var(--gutter) 0",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Brand />
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.2 }}>
            <span style={{ fontWeight: 600 }}>{actor.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {roles}
            </span>
          </span>
          <SignOutButton />
        </div>
      </div>
      <SprintStatus sprint={sprint} />
      <Suspense>
        <NavLinks items={navFor(actor)} />
      </Suspense>
    </header>
  );
}
