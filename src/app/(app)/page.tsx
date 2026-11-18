import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { areas } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function HomePage() {
  const actor = await requirePageActor();
  const [home] = actor.homeAreaId
    ? await db.select({ name: areas.name }).from(areas).where(eq(areas.id, actor.homeAreaId)).limit(1)
    : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 640 }}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 26, lineHeight: 1.2 }}>
        Merhaba, {actor.name.split(" ")[0]}
      </h1>
      <section className="cut-panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="panel-h">Ana alanın</h2>
        <p style={{ margin: 0 }}>{home?.name ?? <span className="muted">Henüz atanmadı</span>}</p>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Ticket&apos;ları ana alanın dışındaki alanlardan alırsın. Böylece birçok alanda yetkinlik kazanırsın.
        </p>
      </section>
      <section className="cut-panel cut-panel--raised" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="panel-h">Ticket iste</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Kıvılcım çakıp rastgele bir ticket alma bir sonraki aşamada açılacak.
        </p>
        <button className="btn-solid" disabled>
          Kıvılcım çak
        </button>
      </section>
    </div>
  );
}
