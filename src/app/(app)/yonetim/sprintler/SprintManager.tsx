"use client";
import { useState, useTransition } from "react";
import { SPRINT_STATUS_LABELS, type SprintRow } from "@/lib/contracts/plan";
import { createSprintAction, startSprintAction, updateSprintAction } from "./actions";
import { endDate, formatDate } from "./dates";
import styles from "./SprintManager.module.css";

export function SprintManager({
  sprints,
  defaultStart,
  defaultLengthDays,
}: {
  sprints: SprintRow[];
  defaultStart: string;
  defaultLengthDays: number;
}) {
  const active = sprints.find((s) => s.status === "active") ?? null;
  const planned = sprints.filter((s) => s.status === "planned").sort((a, b) => a.number - b.number);
  const finished = sprints.filter((s) => s.status === "closed" || s.status === "closing");

  return (
    <div className={styles.page}>
      <h1 className="h-wide">Sprintler</h1>
      <p className="muted">Sprint kapanışı ve bitmemiş ticket kararları bir sonraki aşamada.</p>

      <section className={styles.section} aria-labelledby="aktif-sprint">
        <h2 id="aktif-sprint" className={`h-wide ${styles.sectionTitle}`}>
          Aktif sprint
        </h2>
        {active ? (
          <SprintCard sprint={active} activeExists />
        ) : (
          <p className={`cut-panel ${styles.empty}`}>Şu an aktif sprint yok. Planlanan bir sprinti başlatabilirsin.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="planlanan-sprint">
        <h2 id="planlanan-sprint" className={`h-wide ${styles.sectionTitle}`}>
          Planlanan sprintler
        </h2>
        {planned.length === 0 ? (
          <p className={`cut-panel ${styles.empty}`}>Planlanmış sprint yok.</p>
        ) : (
          <ul className={styles.grid}>
            {planned.map((s) => (
              <li key={s.id}>
                <SprintCard sprint={s} activeExists={active !== null} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewSprintForm defaultStart={defaultStart} defaultLengthDays={defaultLengthDays} />

      {finished.length > 0 && (
        <section className={styles.section} aria-labelledby="kapanan-sprint">
          <h2 id="kapanan-sprint" className={`h-wide ${styles.sectionTitle}`}>
            Kapanan sprintler
          </h2>
          <ul className={styles.grid}>
            {finished.map((s) => (
              <li key={s.id}>
                <article className={`cut-panel ${styles.card} ${styles.closed}`} aria-labelledby={`sprint-${s.id}`}>
                  <div className={styles.head}>
                    <h3 id={`sprint-${s.id}`} className={`h-wide ${styles.name}`}>
                      {s.name}
                    </h3>
                    <span className="muted">{SPRINT_STATUS_LABELS[s.status]}</span>
                  </div>
                  <Meta sprint={s} />
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Meta({ sprint }: { sprint: SprintRow }) {
  return (
    <dl className={styles.meta}>
      <div>
        <dt className="sr-only">Başlangıç</dt>
        <dd>Başlangıç: {formatDate(sprint.startDate)}</dd>
      </div>
      <div>
        <dt className="sr-only">Süre</dt>
        <dd>Süre: {sprint.lengthDays} gün</dd>
      </div>
      <div>
        <dt className="sr-only">Bitiş</dt>
        <dd>Bitiş: {formatDate(endDate(sprint.startDate, sprint.lengthDays))}</dd>
      </div>
    </dl>
  );
}

function SprintCard({ sprint, activeExists }: { sprint: SprintRow; activeExists: boolean }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sprint.name);
  const [startDate, setStartDate] = useState(sprint.startDate);
  const [lengthDays, setLengthDays] = useState(String(sprint.lengthDays));
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const isActive = sprint.status === "active";
  const id = `sprint-${sprint.id}`;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    startTransition(async () => {
      const res = await updateSprintAction({
        sprintId: sprint.id,
        name,
        startDate,
        lengthDays: Number(lengthDays),
      });
      if (res.ok) setEditing(false);
      else {
        setError(res.error);
        setFields(res.fields ?? {});
      }
    });
  }

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await startSprintAction({ sprintId: sprint.id });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <article className={`cut-panel ${styles.card}`} aria-labelledby={id}>
      <div className={styles.head}>
        <h3 id={id} className={`h-wide ${styles.name}`}>
          {sprint.name}
        </h3>
        <span className="muted">{SPRINT_STATUS_LABELS[sprint.status]}</span>
      </div>

      {editing ? (
        <form className={styles.form} onSubmit={save}>
          <div className="field">
            <label className="label" htmlFor={`${id}-name`}>
              Ad
            </label>
            <input
              id={`${id}-name`}
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              required
            />
            {fields.name && <p role="alert">{fields.name}</p>}
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-start`}>
              Başlangıç tarihi
            </label>
            <input
              id={`${id}-start`}
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={pending}
              required
            />
            {fields.startDate && <p role="alert">{fields.startDate}</p>}
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-len`}>
              Süre (gün)
            </label>
            <input
              id={`${id}-len`}
              className="input"
              type="number"
              inputMode="numeric"
              min={3}
              max={90}
              value={lengthDays}
              onChange={(e) => setLengthDays(e.target.value)}
              disabled={pending}
              required
            />
            {fields.lengthDays && <p role="alert">{fields.lengthDays}</p>}
          </div>
          <div className={styles.actions}>
            <button type="submit" className="btn-solid" disabled={pending}>
              Kaydet
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setName(sprint.name);
                setStartDate(sprint.startDate);
                setLengthDays(String(sprint.lengthDays));
                setError(null);
                setFields({});
              }}
            >
              Vazgeç
            </button>
          </div>
        </form>
      ) : (
        <>
          <Meta sprint={sprint} />
          <div className={styles.actions}>
            <button type="button" className="btn-line" onClick={() => setEditing(true)} disabled={pending}>
              Düzenle
            </button>
            {!isActive && (
              <button type="button" className="btn-solid" onClick={start} disabled={pending || activeExists}>
                Başlat
              </button>
            )}
          </div>
          {!isActive && activeExists && (
            <p className="muted">Aynı anda tek aktif sprint olabilir; önce aktif sprint kapanmalı.</p>
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

function NewSprintForm({ defaultStart, defaultLengthDays }: { defaultStart: string; defaultLengthDays: number }) {
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(defaultStart);
  const [lengthDays, setLengthDays] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    setDone(false);
    startTransition(async () => {
      const res = await createSprintAction({
        startDate,
        lengthDays: lengthDays.trim() ? Number(lengthDays) : undefined,
        name: name.trim() || undefined,
      });
      if (res.ok) {
        setLengthDays("");
        setName("");
        setDone(true);
      } else {
        setError(res.error);
        setFields(res.fields ?? {});
      }
    });
  }

  return (
    <form className={`cut-panel ${styles.card} ${styles.form}`} onSubmit={submit} aria-labelledby="yeni-sprint">
      <h2 id="yeni-sprint" className={`h-wide ${styles.sectionTitle}`}>
        Yeni sprint planla
      </h2>
      <div className="field">
        <label className="label" htmlFor="new-sprint-start">
          Başlangıç tarihi
        </label>
        <input
          id="new-sprint-start"
          className="input"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          disabled={pending}
          required
        />
        {fields.startDate && <p role="alert">{fields.startDate}</p>}
      </div>
      <div className="field">
        <label className="label" htmlFor="new-sprint-len">
          Süre (gün, isteğe bağlı)
        </label>
        <input
          id="new-sprint-len"
          className="input"
          type="number"
          inputMode="numeric"
          min={3}
          max={90}
          value={lengthDays}
          placeholder={String(defaultLengthDays)}
          onChange={(e) => setLengthDays(e.target.value)}
          disabled={pending}
          aria-describedby="new-sprint-len-hint"
        />
        <p id="new-sprint-len-hint" className="muted">
          Boş bırakırsan ayarlardaki varsayılan süre ({defaultLengthDays} gün) kullanılır.
        </p>
        {fields.lengthDays && <p role="alert">{fields.lengthDays}</p>}
      </div>
      <div className="field">
        <label className="label" htmlFor="new-sprint-name">
          Ad (isteğe bağlı)
        </label>
        <input
          id="new-sprint-name"
          className="input"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
        />
        {fields.name && <p role="alert">{fields.name}</p>}
      </div>
      <div className={styles.actions}>
        <button type="submit" className="btn-solid" disabled={pending}>
          Sprinti planla
        </button>
      </div>
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
        {done && <p className="notice notice--ok">Sprint planlandı.</p>}
      </div>
    </form>
  );
}
