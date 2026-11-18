"use client";
import { useState, useTransition } from "react";
import { TicketStateChip } from "@/components/plan/TicketStateChip";
import { useLiveRefresh } from "@/components/plan/useLiveRefresh";
import { isTicketEditable, type TicketRef, type TicketRow } from "@/lib/contracts/plan";
import { addDependencyAction, removeDependencyAction, searchPrereqCandidatesAction } from "./actions";
import type { DependencyProps } from "./DependencyWorkspace";
import styles from "./Dependency.module.css";

export function DependencyList({ tickets, canEdit }: DependencyProps) {
  useLiveRefresh();
  const live = tickets.filter((t) => t.status !== "cancelled");
  if (live.length === 0) {
    return <p className={`cut-panel ${styles.skeleton}`}>Bu sprintte bağlantı kurulacak ticket yok.</p>;
  }
  return (
    <ul className={styles.list}>
      {live.map((t) => (
        <li key={t.id}>
          <Card ticket={t} siblings={live} canEdit={canEdit} />
        </li>
      ))}
    </ul>
  );
}

function Card({ ticket: t, siblings, canEdit }: { ticket: TicketRow; siblings: TicketRow[]; canEdit: boolean }) {
  const editable = canEdit && isTicketEditable(t.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TicketRef[] | null>(null);
  const have = new Set(t.prerequisites.map((p) => p.id));
  const options = siblings.filter((s) => s.id !== t.id && !have.has(s.id));
  const id = `dep-${t.id}`;

  function add(dependsOnId: string) {
    setError(null);
    startTransition(async () => {
      const res = await addDependencyAction({ ticketId: t.id, dependsOnId });
      if (res.ok) {
        setPick("");
        setResults(null);
      } else setError(res.error);
    });
  }
  function remove(dependsOnId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeDependencyAction({ ticketId: t.id, dependsOnId });
      if (!res.ok) setError(res.error);
    });
  }
  function search() {
    setError(null);
    startTransition(async () => {
      const res = await searchPrereqCandidatesAction({ ticketId: t.id, query });
      if (res.ok) setResults(res.data);
      else setError(res.error);
    });
  }

  return (
    <article className={`cut-panel ${styles.card}`} aria-labelledby={`${id}-h`}>
      <div>
        <h3 id={`${id}-h`} className={styles.cardTitle}>
          {t.title}
        </h3>
        <TicketStateChip
          status={t.status}
          takeable={t.takeable}
          blockedCount={t.blockedBy.length}
          hint={t.blockedBy.length ? `Bekleniyor: ${t.blockedBy.map((b) => b.title).join(", ")}` : undefined}
        />
      </div>
      <div>
        <span className="label">Şundan sonra:</span>
        {t.prerequisites.length === 0 ? (
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Ön koşul yok: paralel.
          </p>
        ) : (
          <ul className={styles.chips}>
            {t.prerequisites.map((p) => (
              <li key={p.id} className={styles.prChip}>
                <span>
                  {p.title} · {p.areaName}
                </span>
                <span className={styles.seqTag}>sıralı</span>
                {editable && (
                  <button
                    type="button"
                    className={styles.parBtn}
                    aria-label={`Paralel yap: ${p.title} ile bağlantıyı kaldır`}
                    onClick={() => remove(p.id)}
                    disabled={pending}
                  >
                    Paralel yap
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <span className="label">Bitince açılacaklar:</span>
        {t.dependents.length === 0 ? (
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Bu ticket&apos;ı bekleyen yok.
          </p>
        ) : (
          <ul className={styles.waitList}>
            {t.dependents.map((d) => (
              <li key={d.id}>
                {d.title} · {d.areaName}
              </li>
            ))}
          </ul>
        )}
      </div>
      {editable && (
        <>
          <div className={styles.row}>
            <div className="field">
              <label className="label" htmlFor={`${id}-sel`}>
                Ön koşul ekle
              </label>
              <select id={`${id}-sel`} className="select" value={pick} onChange={(e) => setPick(e.target.value)} disabled={pending}>
                <option value="">Aynı alandan seç…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-solid" disabled={pending || !pick} onClick={() => add(pick)}>
              Ekle
            </button>
          </div>
          <div className={styles.row}>
            <div className="field">
              <label className="label" htmlFor={`${id}-q`}>
                Başka alandan ara
              </label>
              <input
                id={`${id}-q`}
                className="input"
                type="search"
                value={query}
                maxLength={100}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
                disabled={pending}
              />
            </div>
            <button type="button" className="btn-line" disabled={pending} onClick={search}>
              Ara
            </button>
          </div>
          {results && (
            <div aria-live="polite">
              {results.length === 0 ? (
                <p className="muted">Eşleşen ticket yok.</p>
              ) : (
                <ul className={styles.results}>
                  {results.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => add(r.id)} disabled={pending}>
                        {r.title} · {r.areaName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      <div aria-live="polite">
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
