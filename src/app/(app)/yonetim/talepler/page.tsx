import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { listOpenRequests } from "@/server/ticket-view";
import { RequestList, isUnanswered } from "./RequestList";

export const metadata = { title: "Talepler" };
export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const actor = await requirePageMainAdmin();
  const now = new Date();
  const nowMs = now.getTime();
  const rows = await listOpenRequests(db, actor, now);
  const late = rows.filter((r) => isUnanswered(r, nowMs));
  const rest = rows.filter((r) => !isUnanswered(r, nowMs));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Talepler
      </h1>
      {rows.length === 0 ? (
        <p className="cut-panel" style={{ padding: 20, margin: 0 }}>
          Şu an bekleyen talep yok. Her şey yolunda.
        </p>
      ) : (
        <>
          {late.length > 0 && (
            <section aria-labelledby="cevapsiz" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 id="cevapsiz" className="h-wide" style={{ margin: 0, fontSize: 18, color: "var(--hot-tx)" }}>
                Cevap bekleyenler ({late.length})
              </h2>
              <RequestList rows={late} now={nowMs} />
            </section>
          )}
          {rest.length > 0 && (
            <section aria-labelledby="bekleyen" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 id="bekleyen" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
                Bekleyen talepler ({rest.length})
              </h2>
              <RequestList rows={rest} now={nowMs} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
