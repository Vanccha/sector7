"use client";
import { useState, useTransition } from "react";
import { Countdown } from "@/components/tickets/Countdown";
import { fmtDateTime } from "@/components/tickets/shared";
import { REQUEST_KIND_LABELS, type RequestRow, type TicketMessage, type TicketPerms } from "@/lib/contracts/tickets";
import {
  approveRequestAction,
  cancelRequestAction,
  postRequestMessageAction,
  rejectRequestAction,
} from "./actions";
import styles from "./Ticket.module.css";

const QUICK_HOURS = [12, 24, 48];

/** Bekleyen talep: konuşma, mesaj, geri alma ve (yetkiliyse) karar. */
export function RequestPanel({
  request,
  messages,
  perms,
  maxGrantedHours,
}: {
  request: RequestRow;
  messages: TicketMessage[];
  perms: TicketPerms;
  maxGrantedHours: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("");
  const isExt = request.kind === "extension";

  function run(fn: () => ReturnType<typeof cancelRequestAction>, onOk?: () => void) {
    setError(null);
    setFields({});
    start(async () => {
      const res = await fn();
      if (res.ok) onOk?.();
      else {
        setError(res.error);
        setFields(res.fields ?? {});
      }
    });
  }

  const thread = messages.filter((m) => m.requestId === request.id || m.requestId === null);

  return (
    <section className={`cut-panel ${styles.section}`} aria-labelledby="pending-h">
      <h2 className="panel-h" id="pending-h">
        Bekleyen talep: {REQUEST_KIND_LABELS[request.kind]}
      </h2>
      <p className={styles.small}>
        {request.requester.name} yazdı · {fmtDateTime(request.createdAt)}
      </p>
      <p className={styles.desc}>{request.reason}</p>
      {request.awaitingRequesterAt ? (
        <p className="notice" role="status">
          {perms.isAssignee ? "Yönetici sana soru sordu, cevabını bekliyor." : "Talep sahibinden cevap bekleniyor; cevap süresi işlemiyor."}
        </p>
      ) : (
        <p className={styles.small}>
          Cevap son anı: {fmtDateTime(request.respondBy)}{" "}
          <Countdown countdown={{ dueAt: request.respondBy, pausedAt: null }} size="sm" warnBeforeHours={2} />
        </p>
      )}

      <div className={styles.col}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Konuşma</h3>
        {thread.length === 0 ? (
          <p className={styles.small}>Henüz mesaj yok.</p>
        ) : (
          <ul className={styles.msgs} aria-label="Talep konuşması">
            {thread.map((m) => (
              <li key={m.id} className={`${styles.msg} ${m.kind === "system" ? styles.msgSystem : ""}`}>
                <span className={styles.msgHead}>
                  {m.kind === "system" ? "Sistem" : (m.author?.name ?? "Bilinmiyor")} · {fmtDateTime(m.createdAt)}
                </span>
                {m.body}
              </li>
            ))}
          </ul>
        )}
        {perms.canMessage ? (
          <form
            className={styles.col}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => postRequestMessageAction({ requestId: request.id, body }), () => setBody(""));
            }}
          >
            <div className="field">
              <label className="label" htmlFor="msg-body">
                Mesaj yaz
              </label>
              <textarea
                id="msg-body"
                className="textarea"
                style={{ minHeight: 72 }}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={4000}
                aria-invalid={fields.body ? true : undefined}
              />
              <p className="field-error" hidden={!fields.body}>
                {fields.body}
              </p>
            </div>
            <div>
              <button type="submit" className="btn-line" disabled={pending || body.trim() === ""}>
                Gönder
              </button>
            </div>
          </form>
        ) : null}
      </div>

      {perms.canCancelRequest ? (
        <div>
          <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(() => cancelRequestAction({ requestId: request.id }))}>
            Talebi geri al
          </button>
        </div>
      ) : null}

      {perms.canRespond ? (
        <div className={styles.col}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Karar</h3>
          {isExt ? (
            <div className="field">
              <label className="label" htmlFor="granted-hours">
                Verilecek ek süre (saat, 1-{maxGrantedHours})
              </label>
              <div className={styles.chips}>
                {QUICK_HOURS.filter((h) => h <= maxGrantedHours).map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={styles.chipBtn}
                    aria-pressed={hours === String(h)}
                    onClick={() => setHours(String(h))}
                  >
                    {h} saat
                  </button>
                ))}
              </div>
              <input
                id="granted-hours"
                className={`input ${styles.hours}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={maxGrantedHours}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-invalid={fields.grantedHours ? true : undefined}
              />
              <p className="field-error" hidden={!fields.grantedHours}>
                {fields.grantedHours}
              </p>
            </div>
          ) : null}
          <div className="field">
            <label className="label" htmlFor="resp-note">
              Not (isteğe bağlı)
            </label>
            <textarea id="resp-note" className="textarea" style={{ minHeight: 72 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </div>
          <div className={styles.row}>
            <button
              type="button"
              className="btn-solid"
              disabled={pending || (isExt && !(Number(hours) >= 1 && Number(hours) <= maxGrantedHours))}
              onClick={() =>
                run(() =>
                  approveRequestAction({
                    requestId: request.id,
                    grantedHours: isExt ? Number(hours) : undefined,
                    note: note.trim() || undefined,
                  }),
                )
              }
            >
              Onayla
            </button>
            <button
              type="button"
              className="btn-line"
              disabled={pending}
              onClick={() => run(() => rejectRequestAction({ requestId: request.id, note: note.trim() || undefined }))}
            >
              Reddet
            </button>
          </div>
        </div>
      ) : null}
      <p role="alert" className="field-error" hidden={!error}>
        {error}
      </p>
    </section>
  );
}
