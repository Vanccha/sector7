import Link from "next/link";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { areas } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SparkRequest } from "@/components/tickets/SparkRequest";
import { TicketCardItem } from "@/components/tickets/shared";
import { getMyTickets } from "@/server/pool";

export default async function HomePage() {
  const actor = await requirePageActor();
  const view = await getMyTickets(db, actor);
  const [home] = actor.homeAreaId
    ? await db.select({ name: areas.name }).from(areas).where(eq(areas.id, actor.homeAreaId)).limit(1)
    : [];
  return (
    <div className="page">
      <h1 className="h-wide" style={{ margin: 0, fontSize: 26, lineHeight: 1.2 }}>
        Merhaba, {actor.name.split(" ")[0]}
      </h1>
      <div className="page-split">
      <div className="page-split__side">
      <section className="cut-panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="panel-h">Ana alanın</h2>
        <p style={{ margin: 0 }}>{home?.name ?? <span className="muted">Henüz atanmadı</span>}</p>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Ticket&apos;ları ana alanın dışındaki alanlardan alırsın. Böylece birçok alanda yetkinlik kazanırsın.
        </p>
      </section>
      <SparkRequest initial={view} />
      <section className="cut-panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="panel-h">Şema</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Şu an kimin hangi alanda çalıştığını canlı gör.
        </p>
        <Link
          href="/sema"
          className="btn-line"
          style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", minHeight: "var(--tap)" }}
        >
          Şemayı aç
        </Link>
      </section>
      </div>
      <section className="skeleton-stack page-split__main" aria-labelledby="active-h">
        <h2 className="panel-h" id="active-h">
          Üstlendiklerin
        </h2>
        {view.active.length === 0 ? (
          <p className="empty-state">Şu an üstlendiğin bir ticket yok.</p>
        ) : (
          <ul className="page-grid">
            {view.active.slice(0, 3).map((t) => (
              <li key={t.id}>
                <TicketCardItem t={t} />
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/ticketlarim"
          className="btn-line"
          style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", minHeight: "var(--tap)" }}
        >
          Tüm ticket&apos;larım
        </Link>
      </section>
      </div>
    </div>
  );
}
