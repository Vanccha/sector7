import Link from "next/link";
import { TICKET_STATUS_LABELS } from "@/lib/contracts/plan";
import { VERDICT_LABELS, type TicketCard, type Verdict } from "@/lib/contracts/tickets";
import { Countdown } from "./Countdown";
import styles from "./tickets.module.css";

const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
export const fmtDateTime = (iso: string) => fmt.format(new Date(iso));

export function StatusBadge({ status }: { status: TicketCard["status"] }) {
  return <span className="badge">{TICKET_STATUS_LABELS[status]}</span>;
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={`badge ${verdict === "good" ? "badge--ok" : ""}`}>{VERDICT_LABELS[verdict]}</span>;
}

/** Ticket kartı: durum, alan, geri sayım ve ticket sayfası bağlantısı. */
export function TicketCardItem({ t, verdicts }: { t: TicketCard; verdicts?: Verdict[] }) {
  return (
    <article className={`cut-panel ${styles.card}`}>
      <div className={styles.cardHead}>
        <StatusBadge status={t.status} />
        {t.countdown.dueAt ? <Countdown countdown={t.countdown} size="sm" /> : null}
      </div>
      <h3 className={`h-wide ${styles.title}`}>
        <Link href={`/ticket/${t.id}`} className={styles.titleLink}>
          {t.title}
        </Link>
      </h3>
      <div className={styles.meta}>
        <span>{t.areaName}</span>
      </div>
      {verdicts && verdicts.length > 0 ? (
        <div className={styles.badges} aria-label="Değerlendirmeler">
          {verdicts.map((v, i) => (
            <VerdictBadge key={i} verdict={v} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
