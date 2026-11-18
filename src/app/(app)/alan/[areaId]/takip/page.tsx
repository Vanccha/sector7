import Link from "next/link";
import { db } from "@/db";
import { SprintPicker } from "@/components/plan/SprintPicker";
import { Countdown } from "@/components/tickets/Countdown";
import { requirePageActor } from "@/lib/auth/session";
import { TICKET_STATUS_LABELS } from "@/lib/contracts/plan";
import { REQUEST_KIND_LABELS, VERDICT_LABELS, type TrackingRow } from "@/lib/contracts/tickets";
import { listPlanningSprints } from "@/server/plan-common";
import { getAreaTracking } from "@/server/ticket-view";
import { RequestList, isUnanswered } from "../../../yonetim/talepler/RequestList";

export const metadata = { title: "Takip" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const sec = { display: "flex", flexDirection: "column", gap: 10 } as const;
const list = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 } as const;

function Row({ r, children }: { r: TrackingRow; children?: React.ReactNode }) {
  return (
    <li>
      <Link href={`/ticket/${r.id}`} className="chip" style={{ minHeight: 44 }}>
        <span className="chip-title">{r.title}</span>
        <span className="chip-row" style={{ flexWrap: "wrap" }}>
          <span className="chip-meta">{TICKET_STATUS_LABELS[r.status]}</span>
          <span>{r.assignee ? r.assignee.name : "Kimse yok"}</span>
          {children}
        </span>
      </Link>
    </li>
  );
}

export default async function TrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ areaId: string }>;
  searchParams: Promise<{ sprint?: string | string[] }>;
}) {
  const { areaId } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.sprint) ? sp.sprint[0] : sp.sprint;
  const actor = await requirePageActor();
  const now = new Date();
  const nowMs = now.getTime();
  const view = await getAreaTracking(db, actor, { areaId, sprintId: raw && UUID.test(raw) ? raw : null }, now);
  const planning = await listPlanningSprints(db);
  const current = view.sprint;
  const sprints = current && !planning.some((s) => s.id === current.id) ? [...planning, current] : planning;

  if (!current) {
    return (
      <p className="cut-panel" style={{ padding: 20, margin: 0 }}>
        Henüz bir sprint yok; takip edilecek bir şey de yok.
      </p>
    );
  }

  const c = view.counts;
  const counters: [string, number][] = [
    ["Taslak", c.draft],
    ["Havuzda", c.pool],
    ["Teklifte", c.offered],
    ["Sürüyor", c.inProgress],
    ["Teslim", c.submitted],
    ["Değerlendirildi", c.evaluated],
    ["İptal", c.cancelled],
  ];
  const submitted = view.toEvaluate.filter((t) => t.status === "submitted");
  const evaluated = view.toEvaluate.filter((t) => t.status !== "submitted");
  const pending = [...view.pendingRequests].sort(
    (a, b) => Number(isUnanswered(b, nowMs)) - Number(isUnanswered(a, nowMs)),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <SprintPicker sprints={sprints} currentId={current.id} />

      <section aria-labelledby="sayaclar">
        <h2 id="sayaclar" className="sr-only">
          Durum sayıları
        </h2>
        <ul style={{ ...list, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {counters.map(([label, n]) => (
            <li key={label} className="cut-panel" style={{ padding: "8px 14px", minWidth: 92 }}>
              <div className="h-wide" style={{ fontSize: 22 }}>
                {n}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {label}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="surenler" style={sec}>
        <h2 id="surenler" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
          Sürenler
        </h2>
        {view.inProgress.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Şu an sürmekte olan ticket yok.
          </p>
        ) : (
          <ul style={list}>
            {view.inProgress.map((r) => (
              <Row key={r.id} r={r}>
                <Countdown countdown={r.countdown} size="sm" />
                {r.pendingRequest && (
                  <span className={r.pendingRequest.overdue ? "chip-urgent" : undefined}>
                    {REQUEST_KIND_LABELS[r.pendingRequest.kind]} talebi
                    {r.pendingRequest.overdue ? " · cevap bekliyor" : " bekliyor"}
                  </span>
                )}
              </Row>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="talepler" style={sec}>
        <h2 id="talepler" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
          Bekleyen talepler
        </h2>
        {pending.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Bekleyen talep yok.
          </p>
        ) : (
          <RequestList rows={pending} showArea={false} now={nowMs} />
        )}
      </section>

      <section aria-labelledby="degerlendirme" style={sec}>
        <h2 id="degerlendirme" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
          Değerlendirme bekleyenler
        </h2>
        {submitted.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Değerlendirme bekleyen teslim yok.
          </p>
        ) : (
          <ul style={list}>
            {submitted.map((r) => (
              <Row key={r.id} r={r}>
                {r.lastSubmittedAt && <span>Teslim: {new Date(r.lastSubmittedAt).toLocaleString("tr-TR")}</span>}
              </Row>
            ))}
          </ul>
        )}
        {evaluated.length > 0 && (
          <>
            <h3 className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
              Değerlendirilenler
            </h3>
            <ul style={list}>
              {evaluated.map((r) => (
                <Row key={r.id} r={r}>
                  {r.verdicts.map((v, i) => (
                    <span key={i} className="chip-meta">
                      {VERDICT_LABELS[v]}
                    </span>
                  ))}
                </Row>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
