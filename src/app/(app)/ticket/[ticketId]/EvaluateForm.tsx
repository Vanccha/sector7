"use client";
import { useState, useTransition } from "react";
import { evaluateTicketAction } from "./actions";
import styles from "./Ticket.module.css";

/** Değerlendirme: iyi / kötü + isteğe bağlı kısa yorum. */
export function EvaluateForm({ ticketId }: { ticketId: string }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(verdict: "good" | "bad") {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await evaluateTicketAction({ ticketId, verdict, comment: comment.trim() || undefined });
      if (res.ok) {
        setDone("Değerlendirmen kaydedildi.");
        setComment("");
      } else setError(res.fields?.comment ?? res.error);
    });
  }

  return (
    <div className={styles.col}>
      <p className={styles.small}>&ldquo;Kötü oldu&rdquo; ceza değildir; yalnız geri bildirimdir.</p>
      <div className="field">
        <label className="label" htmlFor="eval-comment">
          Kısa yorum (isteğe bağlı)
        </label>
        <textarea id="eval-comment" className="textarea" style={{ minHeight: 80 }} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      </div>
      <div className={styles.row}>
        <button type="button" className="btn-solid" disabled={pending} onClick={() => send("good")}>
          İyi oldu
        </button>
        <button type="button" className="btn-line" disabled={pending} onClick={() => send("bad")}>
          Kötü oldu
        </button>
      </div>
      <p role="status" aria-live="polite" className={styles.small}>
        {done}
      </p>
      <p role="alert" className="field-error" hidden={!error}>
        {error}
      </p>
    </div>
  );
}
