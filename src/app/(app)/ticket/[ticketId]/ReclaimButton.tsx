"use client";
import { useState, useTransition } from "react";
import { reclaimTicketAction } from "./actions";
import styles from "./Ticket.module.css";

export function ReclaimButton({ ticketId }: { ticketId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function go() {
    setError(null);
    start(async () => {
      const res = await reclaimTicketAction({ ticketId });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className={styles.col}>
      {!confirm ? (
        <button type="button" className="btn-line" style={{ minHeight: 44, alignSelf: "flex-start" }} onClick={() => setConfirm(true)}>
          Kişi pasif — ticket&apos;ı havuza geri al
        </button>
      ) : (
        <div className="notice">
          <p style={{ margin: "0 0 8px" }}>Ticket havuza döner ve kişinin üzerinden kalkar. Bekleyen talep varsa kapanır. Emin misin?</p>
          <div className={styles.row}>
            <button type="button" className="btn-solid" style={{ minHeight: 44 }} onClick={go} disabled={pending}>
              Havuza geri al
            </button>
            <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => setConfirm(false)} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
