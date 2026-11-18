import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { listManageableAreas } from "@/server/plan-common";

export const metadata = { title: "Alanlarım" };

/** Yönetilen alanların listesi; tek alan varsa doğrudan ona gider. */
export default async function MyAreasPage() {
  const actor = await requirePageActor();
  const areas = await listManageableAreas(db, actor);
  if (areas.length === 0) redirect("/");
  if (areas.length === 1 && !actor.isMainAdmin) redirect(`/alan/${areas[0]!.id}`);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Alanlarım
      </h1>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {areas.map((a) => (
          <li key={a.id}>
            <Link href={`/alan/${a.id}`} className="chip">
              <span className="chip-title">{a.name}</span>
              <span className="chip-meta">Plan, ticket&apos;lar, bağımlılıklar</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
