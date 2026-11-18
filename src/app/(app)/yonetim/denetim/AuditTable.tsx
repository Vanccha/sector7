"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { AuditPage, AuditRow } from "@/lib/contracts/admin";
import { loadMoreAuditAction } from "./actions";
import styles from "./Audit.module.css";

const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Istanbul" });
const SHORT = 160;

export function AuditTable({ initial, query }: { initial: AuditPage; query: string }) {
  const [rows, setRows] = useState<AuditRow[]>(initial.rows);
  const [cursor, setCursor] = useState<number | null>(initial.nextCursor);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function more() {
    if (cursor === null) return;
    setError(null);
    start(async () => {
      const res = await loadMoreAuditAction({ query, cursor });
      if (res.ok) {
        setRows((cur) => {
          const seen = new Set(cur.map((r) => r.id));
          return [...cur, ...res.data.rows.filter((r) => !seen.has(r.id))];
        });
        setCursor(res.data.nextCursor);
      } else setError(res.error);
    });
  }

  if (rows.length === 0) {
    return (
      <p className="cut-panel" style={{ padding: 20, margin: 0 }} role="status">
        Bu süzgece uyan kayıt yok.
      </p>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">Denetim kayıtları, en yeni önce</caption>
        <thead className={styles.thead}>
          <tr>
            <th scope="col">Zaman</th>
            <th scope="col">Yapan</th>
            <th scope="col">Eylem</th>
            <th scope="col">Etkilenen</th>
            <th scope="col">Alan</th>
            <th scope="col">Ticket</th>
            <th scope="col">Ayrıntı</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </tbody>
      </table>
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
      </div>
      {cursor !== null && (
        <button type="button" className="btn-line" style={{ minHeight: 44, alignSelf: "flex-start" }} onClick={more} disabled={pending}>
          {pending ? "Yükleniyor…" : "Daha fazla"}
        </button>
      )}
    </div>
  );
}

function Row({ r }: { r: AuditRow }) {
  const [openBody, setOpenBody] = useState(false);
  const [openData, setOpenData] = useState(false);
  const body = r.messageBody;
  const long = body !== null && body.length > SHORT;
  const hasData = Object.keys(r.data).length > 0;
  const detailId = `audit-d-${r.id}`;
  return (
    <tr className={styles.row}>
      <th scope="row" className={styles.cellTime} data-label="Zaman">
        <time dateTime={r.createdAt}>{fmt.format(new Date(r.createdAt))}</time>
      </th>
      <td data-label="Yapan">{r.actor ? r.actor.name : <span className="muted">Sistem</span>}</td>
      <td data-label="Eylem">
        <span>{r.actionLabel}</span>
        <br />
        <code className={styles.raw}>{r.action}</code>
      </td>
      <td data-label="Etkilenen">{r.subject?.name ?? <span className="muted">—</span>}</td>
      <td data-label="Alan">{r.area?.name ?? <span className="muted">—</span>}</td>
      <td data-label="Ticket">
        {r.ticket ? <Link href={`/ticket/${r.ticket.id}`}>{r.ticket.title}</Link> : <span className="muted">—</span>}
      </td>
      {(
        <td className={styles.extra} data-label="Ayrıntı">
          {body !== null && (
            <blockquote className={styles.quote}>
              {long && !openBody ? `${body.slice(0, SHORT)}…` : body}
              {long && (
                <>
                  {" "}
                  <button type="button" className={styles.linkBtn} aria-expanded={openBody} onClick={() => setOpenBody((o) => !o)}>
                    {openBody ? "Kısalt" : "devamı"}
                  </button>
                </>
              )}
            </blockquote>
          )}
          {hasData && (
            <>
              <button type="button" className={styles.linkBtn} aria-expanded={openData} aria-controls={detailId} onClick={() => setOpenData((o) => !o)}>
                {openData ? "Ayrıntıyı gizle" : "Ayrıntı"}
              </button>
              {openData && (
                <pre id={detailId} className={styles.pre}>
                  {JSON.stringify(r.data, null, 2)}
                </pre>
              )}
            </>
          )}
        </td>
      )}
    </tr>
  );
}
