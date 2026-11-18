import Link from "next/link";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { TICKET_STATUS_LABELS } from "@/lib/contracts/plan";
import { channelLink, type ChannelSummary } from "@/lib/contracts/messaging";
import { LiveRefresh } from "@/components/messaging/LiveRefresh";
import { listChannels } from "@/server/messaging";
import styles from "./Mesajlar.module.css";

export const metadata = { title: "Mesajlar" };

const fmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

function Row({ c, announce = false }: { c: ChannelSummary; announce?: boolean }) {
  return (
    <li>
      <Link href={channelLink(c.id)} className={`${styles.row} ${announce ? styles.announce : ""}`}>
        <span className={styles.name}>
          {c.name}
          <span className={styles.tags}>
            {c.archived ? <span className="badge">arşiv</span> : null}
            {c.kind === "ticket" && c.ticketStatus ? <span className="badge">{TICKET_STATUS_LABELS[c.ticketStatus]}</span> : null}
          </span>
        </span>
        <span className={styles.side}>
          {c.unread > 0 ? (
            <span className={styles.unread} aria-label={`${c.unread} okunmamış mesaj`}>
              {c.unread > 99 ? "99+" : c.unread}
            </span>
          ) : null}
          {c.lastMessageAt ? <time dateTime={c.lastMessageAt}>{fmt.format(new Date(c.lastMessageAt))}</time> : <span>Mesaj yok</span>}
        </span>
      </Link>
    </li>
  );
}

export default async function MesajlarPage() {
  const actor = await requirePageActor();
  const v = await listChannels(db, actor);
  return (
    <div className={styles.page}>
      <LiveRefresh />
      <h1 className={`h-wide ${styles.h1}`}>Mesajlar</h1>

      <section className={styles.group} aria-labelledby="g-ann">
        <h2 className="panel-h" id="g-ann">
          Duyurular
        </h2>
        <ul className={styles.list}>
          <Row c={v.announcement} announce />
        </ul>
      </section>

      <section className={styles.group} aria-labelledby="g-area">
        <h2 className="panel-h" id="g-area">
          Alan kanalları
        </h2>
        {v.areas.length === 0 ? (
          <p className={styles.empty}>Henüz alan kanalı yok.</p>
        ) : (
          <ul className={styles.list}>
            {v.areas.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.group} aria-labelledby="g-ticket">
        <h2 className="panel-h" id="g-ticket">
          Ticket konuşmaları
        </h2>
        {v.tickets.length === 0 ? (
          <p className={styles.empty}>Henüz ticket konuşması yok.</p>
        ) : (
          <ul className={styles.list}>
            {v.tickets.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
