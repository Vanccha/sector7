"use client";
import { useState, useTransition } from "react";
import { createRequestAction } from "./actions";
import styles from "./Ticket.module.css";

type Kind = "extension" | "withdrawal";

const COPY: Record<Kind, { open: string; title: string; hint: string; submit: string }> = {
  extension: {
    open: "Ek süre iste",
    title: "Ek süre talebi",
    hint: "Talep beklerken geri sayımın durur. Sebebini kısaca yaz.",
    submit: "Talebi gönder",
  },
  withdrawal: {
    open: "Geri çekilmesini iste",
    title: "Geri çekme talebi",
    hint: "Kabul ettiğin ticket'ı bırakamazsın; karar alan yöneticisinin. Talep beklerken geri sayımın durur.",
    submit: "Talebi gönder",
  },
};

/** Ek süre / geri çekme talebi formu; sebep zorunlu. */
export function RequestCreate({
  ticketId,
  canExtension,
  canWithdrawal,
}: {
  ticketId: string;
  canExtension: boolean;
  canWithdrawal: boolean;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canExtension && !canWithdrawal) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return;
    setError(null);
    setFieldErr(null);
    start(async () => {
      const res = await createRequestAction({ ticketId, kind, reason });
      if (res.ok) {
        setKind(null);
        setReason("");
      } else {
        setError(res.error);
        setFieldErr(res.fields?.reason ?? null);
      }
    });
  }

  return (
    <section className={`cut-panel ${styles.section}`} aria-labelledby="req-h">
      <h2 className="panel-h" id="req-h">
        Talepler
      </h2>
      {kind === null ? (
        <div className={styles.row}>
          {canExtension ? (
            <button type="button" className="btn-line" onClick={() => setKind("extension")}>
              {COPY.extension.open}
            </button>
          ) : null}
          {canWithdrawal ? (
            <button type="button" className="btn-line" onClick={() => setKind("withdrawal")}>
              {COPY.withdrawal.open}
            </button>
          ) : null}
        </div>
      ) : (
        <form onSubmit={submit} className={styles.col} noValidate>
          <h3 style={{ margin: 0, fontSize: 16 }}>{COPY[kind].title}</h3>
          <p className={styles.small}>{COPY[kind].hint}</p>
          <div className="field">
            <label className="label" htmlFor="req-reason">
              Sebep
            </label>
            <textarea
              id="req-reason"
              className="textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              required
              aria-invalid={fieldErr ? true : undefined}
              aria-describedby={fieldErr ? "req-reason-err" : undefined}
            />
            <p className="field-error" id="req-reason-err" hidden={!fieldErr}>
              {fieldErr}
            </p>
          </div>
          <div className={styles.row}>
            <button type="submit" className="btn-solid" disabled={pending}>
              {COPY[kind].submit}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setKind(null)} disabled={pending}>
              Vazgeç
            </button>
          </div>
          <p role="alert" className="field-error" hidden={!error}>
            {error}
          </p>
        </form>
      )}
    </section>
  );
}
