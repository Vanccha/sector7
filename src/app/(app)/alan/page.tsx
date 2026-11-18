import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sprints } from "@/db/schema";
import { requirePageActor } from "@/lib/auth/session";
import { listManageableAreas } from "@/server/plan-common";

export const metadata = { title: "Alanlarım" };
export const dynamic = "force-dynamic";

/** Yönetilen alanların listesi; kapanışta olan sprint varsa üstte bant. */
export default async function MyAreasPage() {
  const actor = await requirePageActor();
  const [areas, closing] = await Promise.all([
    listManageableAreas(db, actor),
    db.select({ id: sprints.id, name: sprints.name }).from(sprints).where(eq(sprints.status, "closing")),
  ]);
  if (areas.length === 0) redirect("/");
  if (areas.length === 1 && !actor.isMainAdmin && closing.length === 0) redirect(`/alan/${areas[0]!.id}`);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Alanlarım
      </h1>
      {closing.map((s) => (
        <Link
          key={s.id}
          href={`/sprint/${s.id}/kapanis`}
          className="notice notice--hot"
          style={{ display: "block", minHeight: 44, fontWeight: 600 }}
        >
          {s.name} kapanıyor — kararlarını ver
        </Link>
      ))}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {areas.map((a) => (
          <li key={a.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Link href={`/alan/${a.id}`} className="chip">
              <span className="chip-title">{a.name}</span>
              <span className="chip-meta">Plan, ticket&apos;lar, bağımlılıklar</span>
            </Link>
            <Link href={`/alan/${a.id}/takip`} className="btn-line" style={{ alignSelf: "flex-start" }}>
              Takip
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
