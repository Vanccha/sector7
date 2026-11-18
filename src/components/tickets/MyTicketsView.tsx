import type { MyTicketsView as View } from "@/lib/contracts/tickets";
import { OfferCard } from "./OfferCard";
import { TicketCardItem } from "./shared";
import styles from "./tickets.module.css";

/** /ticketlarim: teklif (varsa), aktif ticket'lar, son teslimler. */
export function MyTicketsView({ view }: { view: View }) {
  return (
    <div className={styles.stack} style={{ gap: 24 }}>
      {view.offer ? <OfferCard offer={view.offer} rejections={view.rejections} /> : null}
      <section className={styles.stack} aria-labelledby="active-h">
        <h2 className="h-wide" id="active-h" style={{ margin: 0, fontSize: 18 }}>
          Üstlendiklerin
        </h2>
        {view.active.length === 0 ? (
          <p className={styles.empty}>Şu an üstlendiğin bir ticket yok. Ana sayfadan kıvılcım çakabilirsin.</p>
        ) : (
          <ul className={styles.list}>
            {view.active.map((t) => (
              <li key={t.id}>
                <TicketCardItem t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.stack} aria-labelledby="recent-h">
        <h2 className="h-wide" id="recent-h" style={{ margin: 0, fontSize: 18 }}>
          Son teslimlerin
        </h2>
        {view.recent.length === 0 ? (
          <p className={styles.empty}>Henüz teslim ettiğin bir ticket yok.</p>
        ) : (
          <ul className={styles.list}>
            {view.recent.map((t) => (
              <li key={t.id}>
                <TicketCardItem t={t} verdicts={t.verdicts} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
