import Link from "next/link";
import { Countdown } from "@/components/tickets/Countdown";
import { REQUEST_KIND_LABELS, type OpenRequestRow } from "@/lib/contracts/tickets";

function fmtDur(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d > 0) return `${d} gün ${h} sa`;
  if (h > 0) return `${h} sa ${min % 60} dk`;
  return `${min} dk`;
}

/** Cevap süresi geçmiş ya da cevapsız işaretli mi (talep sahibinden cevap beklenmiyorsa). */
export function isUnanswered(r: OpenRequestRow, nowMs: number): boolean {
  return r.overdueAt !== null || (Date.parse(r.respondBy) <= nowMs && !r.awaitingRequesterAt);
}

/** Sunucu bileşeni: bekleyen talep satırları. Cevapsızlar vurgulu. */
export function RequestList({ rows, showArea = true, now }: { rows: OpenRequestRow[]; showArea?: boolean; now: number }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => {
        const respondMs = Date.parse(r.respondBy) - now;
        const overdue = isUnanswered(r, now);
        return (
          <li key={r.id}>
            <Link
              href={`/ticket/${r.ticketId}`}
              className="chip"
              style={{ minHeight: 44, borderLeft: overdue ? "3px solid var(--hot-tx)" : undefined }}
            >
              {overdue && (
                <span className="chip-urgent">
                  Cevapsız — süre {fmtDur(Math.abs(respondMs))} önce doldu
                </span>
              )}
              <span className="chip-title">{r.ticket.title}</span>
              <span className="chip-row" style={{ flexWrap: "wrap" }}>
                <span className="chip-meta">{REQUEST_KIND_LABELS[r.kind]}</span>
                {showArea && <span>{r.ticket.areaName}</span>}
                <span>Talep sahibi: {r.requester.name}</span>
                <Countdown countdown={r.ticket.countdown} size="sm" />
              </span>
              <span style={{ fontSize: 14 }}>{r.reason.length > 140 ? `${r.reason.slice(0, 140)}…` : r.reason}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {r.awaitingRequesterAt
                  ? "Talep sahibinin cevabı bekleniyor"
                  : overdue
                    ? "Cevap bekliyor"
                    : `Cevap için kalan: ${fmtDur(respondMs)}`}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
