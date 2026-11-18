"use client";
import { useState, useTransition } from "react";
import { approveApplicationAction, rejectApplicationAction } from "./actions";
import styles from "./ApplicationReview.module.css";

export type ReviewItem = {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  intro: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
};
type Area = { id: string; name: string };
type Status = "pending" | "approved" | "rejected";

const fmt = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});
const date = (iso: string) => fmt.format(new Date(iso));

const EMPTY: Record<Status, string> = {
  pending: "Şu an bekleyen başvuru yok. Yenisi geldiğinde burada görünecek.",
  approved: "Henüz onaylanmış bir başvuru yok.",
  rejected: "Reddedilmiş bir başvuru yok.",
};

type Decision = { kind: "approved"; url: string; expiresAt: string } | { kind: "rejected" };

export function ApplicationReview({ status, items, areas }: { status: Status; items: ReviewItem[]; areas: Area[] }) {
  // Karar verilen kartlar, sunucu listesi yenilenip kart listeden düşse de sonucuyla (ör. tek kullanımlık
  // şifre bağlantısıyla) bu oturumda görünür kalır.
  const [decided, setDecided] = useState<Record<string, { item: ReviewItem; decision: Decision }>>({});
  const ids = new Set(items.map((i) => i.id));
  const list = [...Object.values(decided).filter((d) => !ids.has(d.item.id)).map((d) => d.item), ...items];

  if (list.length === 0) {
    return <p className={`cut-panel ${styles.empty}`}>{EMPTY[status]}</p>;
  }
  return (
    <ul className={styles.grid}>
      {list.map((it) => (
        <li key={it.id}>
          <Card
            item={it}
            status={status}
            areas={areas}
            decision={decided[it.id]?.decision ?? null}
            onDecided={(decision) => setDecided((d) => ({ ...d, [it.id]: { item: it, decision } }))}
          />
        </li>
      ))}
    </ul>
  );
}

function Card({
  item,
  status,
  areas,
  decision,
  onDecided,
}: {
  item: ReviewItem;
  status: Status;
  areas: Area[];
  decision: Decision | null;
  onDecided: (d: Decision) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = decision?.kind === "approved" ? { url: decision.url, expiresAt: decision.expiresAt } : null;
  const rejected = decision?.kind === "rejected";

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approveApplicationAction({ applicationId: item.id, homeAreaId: areaId });
      if (res.ok) onDecided({ kind: "approved", url: res.data.setupUrl, expiresAt: res.data.expiresAt });
      else setError(res.fields?.homeAreaId ?? res.error);
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectApplicationAction({ applicationId: item.id, note: note.trim() || undefined });
      if (res.ok) onDecided({ kind: "rejected" });
      else setError(res.error);
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError("Kopyalanamadı; bağlantıyı seçip elle kopyalayabilirsin.");
    }
  }

  const nameId = `app-${item.id}`;
  const done = link !== null || rejected;

  return (
    <article className={`cut-panel ${styles.card}`} aria-labelledby={nameId}>
      <div>
        <h2 id={nameId} className={`h-wide ${styles.name}`}>
          {item.fullName}
        </h2>
        <span className="muted">@{item.username}</span>
      </div>
      <dl className={styles.meta}>
        <div>
          <dt className="sr-only">E-posta</dt>
          <dd style={{ margin: 0 }}>
            <a href={`mailto:${item.email}`}>{item.email}</a>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Telefon</dt>
          <dd style={{ margin: 0 }}>
            <a href={`tel:${item.phone}`}>{item.phone}</a>
          </dd>
        </div>
      </dl>
      <p className={styles.intro}>{item.intro}</p>
      <p className="muted">Başvuru: {date(item.createdAt)}</p>

      {status !== "pending" && (
        <>
          {item.reviewedAt && (
            <p className="muted">
              {status === "approved" ? "Onaylandı" : "Reddedildi"}: {date(item.reviewedAt)}
            </p>
          )}
          {status === "rejected" && item.reviewNote && <p>Not: {item.reviewNote}</p>}
        </>
      )}

      {status === "pending" && link && (
        <div className="notice notice--ok" role="status">
          <p>Başvuru onaylandı. Şifre belirleme bağlantısı:</p>
          <code className={styles.linkBox}>{link.url}</code>
          <p className="muted">Geçerlilik bitişi: {date(link.expiresAt)}</p>
          <p>Bu bağlantı yalnız şimdi görünür; kişiye ilet.</p>
          <button type="button" className="btn-line" onClick={copy}>
            {copied ? "Kopyalandı" : "Kopyala"}
          </button>
        </div>
      )}

      {status === "pending" && rejected && (
        <p className="notice" role="status">
          Başvuru reddedildi.
        </p>
      )}

      {status === "pending" && !done && (
        <>
          <div className="field">
            <label className="label" htmlFor={`area-${item.id}`}>
              Ana alan
            </label>
            <select
              id={`area-${item.id}`}
              className="select"
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              disabled={pending}
            >
              {areas.length === 0 && <option value="">Aktif alan yok</option>}
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn-solid" onClick={approve} disabled={pending || !areaId}>
              Onayla
            </button>
            {!rejecting && (
              <button type="button" className="btn-line" onClick={() => setRejecting(true)} disabled={pending}>
                Reddet
              </button>
            )}
          </div>
          {rejecting && (
            <div className="field">
              <label className="label" htmlFor={`note-${item.id}`}>
                Not (isteğe bağlı)
              </label>
              <textarea
                id={`note-${item.id}`}
                className="textarea"
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className={styles.actions}>
                <button type="button" className="btn-line" onClick={reject} disabled={pending}>
                  Reddi onayla
                </button>
                <button type="button" className="btn-ghost" onClick={() => setRejecting(false)} disabled={pending}>
                  Vazgeç
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
