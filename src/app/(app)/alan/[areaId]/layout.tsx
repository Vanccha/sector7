import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { NavLinks } from "@/components/shell/NavLinks";
import { canManageArea } from "@/lib/auth/guards";
import { requirePageActor } from "@/lib/auth/session";
import { getAreaOrThrow } from "@/server/plan-common";

/**
 * Alan planı bölümü: /alan/[areaId] (hedef + roadmap), /ticketlar, /bagimliliklar.
 * Seçili sprint `?sprint=<id>` sorgusunda taşınır; yoksa aktif sprint.
 */
export default async function AreaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = await params;
  const actor = await requirePageActor();
  if (!/^[0-9a-f-]{36}$/i.test(areaId)) notFound();
  const area = await getAreaOrThrow(db, areaId).catch(() => null);
  if (!area) notFound();
  if (!canManageArea(actor, areaId)) redirect("/");
  const base = `/alan/${areaId}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Alan
        </span>
        <h1 className="h-wide" style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>
          {area.name}
          {area.archivedAt && (
            <span className="muted" style={{ fontSize: 14, fontWeight: 500, marginLeft: 10 }}>
              (arşivlendi)
            </span>
          )}
        </h1>
      </div>
      <Suspense>
        <NavLinks
          label="Alan bölümleri"
          keepQuery={["sprint"]}
          items={[
            { href: base, label: "Hedef ve roadmap", exact: true },
            { href: `${base}/ticketlar`, label: "Ticket'lar" },
            { href: `${base}/bagimliliklar`, label: "Bağımlılıklar" },
          ]}
        />
      </Suspense>
      {children}
    </div>
  );
}
