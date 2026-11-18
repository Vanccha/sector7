import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { AppError } from "@/lib/contracts/errors";
import { TICKET_STATUS_LABELS } from "@/lib/contracts/plan";
import {
  REQUEST_KIND_LABELS,
  REQUEST_STATUS_LABELS,
  type OfferView,
  type TicketDetail,
} from "@/lib/contracts/tickets";
import { Countdown } from "@/components/tickets/Countdown";
import { OfferCard } from "@/components/tickets/OfferCard";
import { StatusBadge, VerdictBadge, fmtDateTime } from "@/components/tickets/shared";
import { ChannelThread } from "@/components/messaging/ChannelThread";
import { getChannelView, getTicketChannelId } from "@/server/messaging";
import { getTicketDetail } from "@/server/ticket-view";
import { EvaluateForm } from "./EvaluateForm";
import { RequestCreate } from "./RequestCreate";
import { RequestPanel } from "./RequestPanel";
import { SubmitForm } from "./SubmitForm";
import styles from "./Ticket.module.css";

export const metadata = { title: "Ticket" };

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const actor = await requirePageActor();
  let d: TicketDetail | null = null;
  try {
    d = await getTicketDetail(db, actor, { ticketId });
  } catch (e) {
    const missing = e instanceof ZodError || (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN"));
    if (!missing) throw e;
  }
  if (!d) notFound();

  const { ticket: t, perms, limits } = d;
  const channelView = await getChannelView(db, actor, { channelId: await getTicketChannelId(db, actor, { ticketId }) });
  const pastRequests = d.requests.filter((r) => r.id !== d.pendingRequest?.id);
  const offer: OfferView | null =
    perms.canAnswerOffer && t.offeredAt && t.offerExpiresAt && d.rejections
      ? { ticket: t, offeredAt: t.offeredAt, expiresAt: t.offerExpiresAt }
      : null;
  const showCountdown = !!t.countdown.dueAt && t.status !== "submitted" && t.status !== "evaluated";
  const canRequest = perms.canRequestExtension || perms.canRequestWithdrawal;

  return (
    <div className={styles.page}>
      <header className={styles.section}>
        <div className={styles.meta}>
          <StatusBadge status={t.status} />
          <span>{t.areaName}</span>
          <span>{t.sprintName}</span>
          {t.assignee ? <span>Üstlenen: {t.assignee.name}</span> : null}
        </div>
        <h1 className={`h-wide ${styles.h1}`}>{t.title}</h1>
        {showCountdown ? (
          <div className={styles.timer}>
            <span className={styles.timerLabel}>Kalan süre</span>
            <Countdown countdown={t.countdown} size="lg" />
          </div>
        ) : null}
      </header>

      {offer && d.rejections ? <OfferCard offer={offer} rejections={d.rejections} stayOnAccept heading={false} /> : null}

      <section className={`cut-panel ${styles.section}`} aria-labelledby="detail-h">
        <h2 className="panel-h" id="detail-h">
          Ticket
        </h2>
        {t.description ? <p className={styles.desc}>{t.description}</p> : <p className="muted">Açıklama yok.</p>}
        {d.prerequisites.length > 0 ? (
          <div className={styles.col}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Ön koşullar</h3>
            <ul className={styles.plain}>
              {d.prerequisites.map((p) => (
                <li key={p.id} className={styles.small}>
                  {p.title} · {p.areaName} · {TICKET_STATUS_LABELS[p.status]}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {d.pendingRequest ? (
        <RequestPanel request={d.pendingRequest} perms={perms} maxGrantedHours={limits.maxGrantedHours} />
      ) : canRequest ? (
        <RequestCreate ticketId={t.id} canExtension={perms.canRequestExtension} canWithdrawal={perms.canRequestWithdrawal} />
      ) : null}

      <section className={`cut-panel ${styles.section}`} aria-labelledby="talk-h">
        <h2 className="panel-h" id="talk-h">
          Konuşma
        </h2>
        <ChannelThread view={channelView} ticketChannel />
      </section>

      {pastRequests.length > 0 ? (
        <section className={`cut-panel ${styles.section}`} aria-labelledby="past-h">
          <h2 className="panel-h" id="past-h">
            Geçmiş talepler
          </h2>
          <ul className={styles.plain}>
            {pastRequests.map((r) => (
              <li key={r.id} className={styles.item}>
                <div className={styles.meta}>
                  <span className="badge">{REQUEST_KIND_LABELS[r.kind]}</span>
                  <span>{REQUEST_STATUS_LABELS[r.status]}</span>
                  {r.grantedHours ? <span>{r.grantedHours} saat verildi</span> : null}
                  <span>{fmtDateTime(r.createdAt)}</span>
                </div>
                <p className={styles.desc}>{r.reason}</p>
                {r.responseNote ? (
                  <p className={styles.small}>
                    {r.respondedBy ? `${r.respondedBy.name}: ` : ""}
                    {r.responseNote}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {perms.canSubmit ? (
        <section className={`cut-panel ${styles.section}`} aria-labelledby="submit-h">
          <h2 className="panel-h" id="submit-h">
            {t.status === "submitted" ? "Yeniden teslim" : "Teslim"}
          </h2>
          <SubmitForm key={d.submissions[0]?.id ?? "none"} ticketId={t.id} resubmit={d.submissions.length > 0} limits={limits} />
        </section>
      ) : null}

      {d.submissions.length > 0 ? (
        <section className={`cut-panel ${styles.section}`} aria-labelledby="subs-h">
          <h2 className="panel-h" id="subs-h">
            Teslimler
          </h2>
          <ul className={styles.plain}>
            {d.submissions.map((s, i) => (
              <li key={s.id} className={styles.item}>
                <div className={styles.meta}>
                  {i === 0 ? <span className="badge badge--ok">Geçerli teslim</span> : null}
                  <span>{s.user.name}</span>
                  <span>{fmtDateTime(s.createdAt)}</span>
                </div>
                <p className={styles.desc}>{s.description}</p>
                {s.links.length > 0 ? (
                  <ul className={`${styles.plain} ${styles.links}`} aria-label="Bağlantılar">
                    {s.links.map((l, j) => (
                      <li key={j}>
                        <a href={l} rel="noopener noreferrer" target="_blank">
                          {l}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {s.files.length > 0 ? (
                  <ul className={`${styles.plain} ${styles.links}`} aria-label="Dosyalar">
                    {s.files.map((f) => (
                      <li key={f.id}>
                        <a href={`/api/dosya/${f.id}`} download>
                          {f.name}
                        </a>{" "}
                        <span className="muted">({(f.sizeBytes / 1024 / 1024).toFixed(2)} MB)</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {perms.canEvaluate ? (
        <section className={`cut-panel ${styles.section}`} aria-labelledby="eval-h">
          <h2 className="panel-h" id="eval-h">
            Değerlendir
          </h2>
          <EvaluateForm ticketId={t.id} />
        </section>
      ) : null}

      {d.evaluations.length > 0 ? (
        <section className={`cut-panel ${styles.section}`} aria-labelledby="evals-h">
          <h2 className="panel-h" id="evals-h">
            Değerlendirmeler
          </h2>
          <ul className={styles.plain}>
            {d.evaluations.map((e) => (
              <li key={e.id} className={styles.item}>
                <div className={styles.meta}>
                  <VerdictBadge verdict={e.verdict} />
                  <span>{e.evaluator.name}</span>
                  <span>{fmtDateTime(e.createdAt)}</span>
                </div>
                {e.comment ? <p className={styles.desc}>{e.comment}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
