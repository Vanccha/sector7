"use client";
import { useState, useTransition } from "react";
import { ROADMAP_STATUS_LABELS, type RoadmapReviewItem } from "@/lib/contracts/plan";
import { approveRoadmapAction, returnRoadmapAction } from "./actions";
import styles from "./RoadmapReview.module.css";

const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const date = (iso: string) => fmt.format(new Date(iso));

type Decision = "approved" | "returned";

export function RoadmapReview({ items, all }: { items: RoadmapReviewItem[]; all: boolean }) {
  // Karar verilen kartlar, liste yenilenip düşse de sonucuyla bu oturumda görünür kalır.
  const [decided, setDecided] = useState<Record<string, { item: RoadmapReviewItem; decision: Decision }>>({});
  const ids = new Set(items.map((i) => i.roadmapId));
  const list = [
    ...Object.values(decided)
      .filter((d) => !ids.has(d.item.roadmapId))
      .map((d) => d.item),
    ...items,
  ];
  if (list.length === 0) {
    return (
      <p className={`cut-panel ${styles.empty}`}>
        {all
          ? "Planlama sprintlerinde henüz roadmap yok."
          : "Şu an onay bekleyen roadmap yok. Yenisi geldiğinde burada görünecek."}
      </p>
    );
  }
  return (
    <ul className={styles.grid}>
      {list.map((it) => (
        <li key={it.roadmapId}>
          <Card
            item={it}
            decision={decided[it.roadmapId]?.decision ?? null}
            onDecided={(d) => setDecided((s) => ({ ...s, [it.roadmapId]: { item: it, decision: d } }))}
          />
        </li>
      ))}
    </ul>
  );
}

function Card({
  item,
  decision,
  onDecided,
}: {
  item: RoadmapReviewItem;
  decision: Decision | null;
  onDecided: (d: Decision) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const goalName = (id: string | null) => item.goals.find((g) => g.id === id)?.title ?? null;
  const canDecide = item.status === "submitted" && decision === null;
  const nameId = `rm-${item.roadmapId}`;

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approveRoadmapAction({ roadmapId: item.roadmapId });
      if (res.ok) onDecided("approved");
      else setError(res.error);
    });
  }
  function giveBack() {
    setError(null);
    startTransition(async () => {
      const res = await returnRoadmapAction({ roadmapId: item.roadmapId, note });
      if (res.ok) onDecided("returned");
      else setError(res.fields?.note ?? res.error);
    });
  }

  return (
    <article className={`cut-panel ${styles.card}`} aria-labelledby={nameId}>
      <div>
        <h2 id={nameId} className={`h-wide ${styles.name}`}>
          {item.area.name}
        </h2>
        <span className="muted">
          {item.sprint.name} · <span
            className={
              (decision ?? item.status) === "approved"
                ? "badge badge--ok"
                : (decision ?? item.status) === "returned"
                  ? "badge badge--hot"
                  : "badge"
            }
          >
            {ROADMAP_STATUS_LABELS[decision ?? item.status]}
          </span>
        </span>
      </div>
      {item.submittedAt && <p className="muted">Gönderildi: {date(item.submittedAt)}</p>}

      <section aria-label="Hedefler">
        <h3 className={styles.sub}>Hedefler</h3>
        {item.goals.length === 0 ? (
          <p className="muted">Hedef girilmemiş.</p>
        ) : (
          <ul className={styles.plain}>
            {item.goals.map((g) => (
              <li key={g.id}>
                <strong>{g.title}</strong>
                {g.requirements && <p className={styles.text}>{g.requirements}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Basamaklar">
        <h3 className={styles.sub}>Basamaklar</h3>
        <ol className={styles.list}>
          {item.steps.map((s) => (
            <li key={s.id}>
              <strong>{s.title}</strong>
              {s.description && <p className={styles.text}>{s.description}</p>}
              {goalName(s.goalId) && <span className="muted">Hedef: {goalName(s.goalId)}</span>}
            </li>
          ))}
        </ol>
      </section>

      {decision === "approved" && (
        <p className="notice notice--ok" role="status">
          Roadmap onaylandı.
        </p>
      )}
      {decision === "returned" && (
        <p className="notice" role="status">
          Roadmap notla geri gönderildi.
        </p>
      )}

      {canDecide && (
        <>
          <div className={styles.actions}>
            <button type="button" className="btn-solid" onClick={approve} disabled={pending}>
              Onayla
            </button>
            {!returning && (
              <button type="button" className="btn-line" onClick={() => setReturning(true)} disabled={pending}>
                Notla geri gönder
              </button>
            )}
          </div>
          {returning && (
            <div className="field">
              <label className="label" htmlFor={`note-${item.roadmapId}`}>
                Geri gönderme notu
              </label>
              <textarea
                id={`note-${item.roadmapId}`}
                className="textarea"
                rows={3}
                maxLength={2000}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className="btn-line"
                  onClick={giveBack}
                  disabled={pending || note.trim().length < 3}
                >
                  Geri gönder
                </button>
                <button type="button" className="btn-ghost" onClick={() => setReturning(false)} disabled={pending}>
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
