"use client";
import { useState, useTransition } from "react";
import { TicketStateChip } from "@/components/plan/TicketStateChip";
import { useLiveRefresh } from "@/components/plan/useLiveRefresh";
import { TICKET_STATUS_LABELS, type AreaTicketsView, type StepRow, type TicketRow } from "@/lib/contracts/plan";
import {
  cancelTicketAction,
  createTicketAction,
  createTicketsFromStepsAction,
  publishTicketsAction,
  updateTicketAction,
} from "./actions";
import styles from "./TicketList.module.css";

export function TicketList({
  view,
  roadmapId,
  approved,
}: {
  view: AreaTicketsView;
  roadmapId: string | null;
  approved: boolean;
}) {
  const { tickets, steps, canEdit } = view;
  useLiveRefresh();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const drafts = tickets.filter((t) => t.status === "draft");
  const pool = tickets.filter((t) => t.status === "available" || t.status === "returned_to_pool");
  const others = tickets.filter((t) => !["draft", "available", "returned_to_pool", "cancelled"].includes(t.status));
  const cancelled = tickets.filter((t) => t.status === "cancelled");
  const chosen = drafts.filter((t) => selected.has(t.id)).map((t) => t.id);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function publish(ids: string[]) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await publishTicketsAction({ ticketIds: ids });
      if (res.ok) {
        setSelected(new Set());
        setInfo(`${res.data.published} ticket havuza yayınlandı.`);
      } else setError(res.error);
    });
  }

  function createAll() {
    if (!roadmapId) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await createTicketsFromStepsAction({ roadmapId });
      if (res.ok) setInfo(res.data.created ? `${res.data.created} taslak ticket oluşturuldu.` : "Ticket'ı olmayan basamak yok.");
      else setError(res.error);
    });
  }

  return (
    <>
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="notice notice--ok" role="status">
            {info}
          </p>
        )}
      </div>

      {approved && (
        <section className={styles.section} aria-labelledby="steps-h">
          <div className={styles.sectionHead}>
            <h2 id="steps-h" className="h-wide">
              Basamaklar
            </h2>
            {canEdit && steps.length > 0 && (
              <button type="button" className="btn-line" onClick={createAll} disabled={pending}>
                Ticket&apos;ı olmayan tüm basamaklardan oluştur
              </button>
            )}
          </div>
          {steps.length === 0 ? (
            <p className={`cut-panel ${styles.empty}`}>Onaylı roadmap&apos;te basamak yok.</p>
          ) : (
            <ul className={styles.grid}>
              {steps.map((s) => (
                <li key={s.id}>
                  <StepCard step={s} canEdit={canEdit} onError={setError} onInfo={setInfo} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={styles.section} aria-labelledby="drafts-h">
        <div className={styles.sectionHead}>
          <h2 id="drafts-h" className="h-wide">
            Taslaklar <span className="count">{drafts.length}</span>
          </h2>
          {canEdit && drafts.length > 0 && (
            <>
              <button
                type="button"
                className="btn-solid"
                disabled={pending || chosen.length === 0}
                onClick={() => publish(chosen)}
              >
                Seçilenleri yayınla ({chosen.length})
              </button>
              <button
                type="button"
                className="btn-line"
                disabled={pending}
                onClick={() => publish(drafts.map((t) => t.id))}
              >
                Tüm taslakları yayınla
              </button>
            </>
          )}
        </div>
        {canEdit && drafts.length > 0 && (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Ön koşulu bekleyenler havuza girer ama ön koşul teslim edilene kadar kimseye düşmez.
          </p>
        )}
        <Group
          items={drafts}
          empty="Taslak ticket yok."
          canEdit={canEdit}
          selectable={canEdit}
          selected={selected}
          onToggle={toggle}
        />
      </section>

      <section className={styles.section} aria-labelledby="pool-h">
        <h2 id="pool-h" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
          Havuzda <span className="count">{pool.length}</span>
        </h2>
        <Group items={pool} empty="Havuzda ticket yok." canEdit={canEdit} showTakeable />
      </section>

      {others.length > 0 && (
        <section className={styles.section} aria-labelledby="other-h">
          <h2 id="other-h" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
            Diğer durumlar <span className="count">{others.length}</span>
          </h2>
          <Group items={others} empty="" canEdit={false} />
        </section>
      )}

      {cancelled.length > 0 && (
        <section className={styles.section} aria-labelledby="cancel-h">
          <h2 id="cancel-h" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
            İptaller <span className="count">{cancelled.length}</span>
          </h2>
          <Group items={cancelled} empty="" canEdit={false} />
        </section>
      )}
    </>
  );
}

function StepCard({
  step,
  canEdit,
  onError,
  onInfo,
}: {
  step: StepRow;
  canEdit: boolean;
  onError: (e: string | null) => void;
  onInfo: (m: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(step.title);
  const [pending, startTransition] = useTransition();
  const id = `step-title-${step.id}`;

  function create(custom: boolean) {
    onError(null);
    onInfo(null);
    startTransition(async () => {
      const res = await createTicketAction({
        roadmapStepId: step.id,
        title: custom && title.trim() !== step.title ? title.trim() : undefined,
      });
      if (res.ok) {
        setOpen(false);
        onInfo("Taslak ticket oluşturuldu.");
      } else onError(res.fields?.title ?? res.error);
    });
  }

  return (
    <div className={`cut-panel ${styles.stepRow}`}>
      <div>
        <h3 className={styles.title} style={{ fontSize: 15 }}>
          {step.title}
        </h3>
        <span className="muted" style={{ fontSize: 13 }}>
          {step.ticketCount} ticket
        </span>
      </div>
      {canEdit &&
        (open ? (
          <div className={styles.form}>
            <div className="field">
              <label className="label" htmlFor={id}>
                Ticket başlığı
              </label>
              <input
                id={id}
                className="input"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className={styles.actions}>
              <button type="button" className="btn-solid" disabled={pending || title.trim().length < 2} onClick={() => create(true)}>
                Oluştur
              </button>
              <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>
                Vazgeç
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <button type="button" className="btn-line" disabled={pending} onClick={() => create(false)}>
              Ticket oluştur
            </button>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(true)}>
              Başlığı değiştirerek oluştur
            </button>
          </div>
        ))}
    </div>
  );
}

function Group({
  items,
  empty,
  canEdit,
  selectable,
  selected,
  onToggle,
  showTakeable,
}: {
  items: TicketRow[];
  empty: string;
  canEdit: boolean;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  showTakeable?: boolean;
}) {
  if (items.length === 0) return empty ? <p className={`cut-panel ${styles.empty}`}>{empty}</p> : null;
  return (
    <ul className={styles.grid}>
      {items.map((t) => (
        <li key={t.id}>
          <TicketCard
            ticket={t}
            canEdit={canEdit}
            selectable={selectable}
            checked={selected?.has(t.id) ?? false}
            onToggle={onToggle}
            showTakeable={showTakeable}
          />
        </li>
      ))}
    </ul>
  );
}

function TicketCard({
  ticket: t,
  canEdit,
  selectable,
  checked,
  onToggle,
  showTakeable,
}: {
  ticket: TicketRow;
  canEdit: boolean;
  selectable?: boolean;
  checked: boolean;
  onToggle?: (id: string) => void;
  showTakeable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = canEdit && ["draft", "available", "returned_to_pool"].includes(t.status);
  const tid = `t-${t.id}`;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateTicketAction({ ticketId: t.id, title: title.trim(), description: desc });
      if (res.ok) setEditing(false);
      else setError(res.fields?.title ?? res.fields?.description ?? res.error);
    });
  }
  function cancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelTicketAction({ ticketId: t.id });
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <article className={`chip ${styles.card} ${t.status === "cancelled" ? styles.cancelled : ""}`} aria-labelledby={`${tid}-h`}>
      <div className={styles.cardTop}>
        {selectable && (
          <label>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle?.(t.id)}
              aria-label={`Seç: ${t.title}`}
            />
          </label>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 id={`${tid}-h`} className={`chip-title ${styles.title}`}>
            {t.title}
          </h3>
          <div className="chip-row">
            <span>{TICKET_STATUS_LABELS[t.status]}</span>
            {showTakeable && t.takeable && <span className={`${styles.badge} ${styles.badgeOk}`}>Alınabilir</span>}
            {showTakeable && !t.takeable && t.blockedBy.length > 0 && (
              <TicketStateChip
                status={t.status}
                takeable={false}
                blockedCount={t.blockedBy.length}
                hint={`Bekleniyor: ${t.blockedBy.map((b) => `${b.title} · ${b.areaName}`).join(", ")}`}
              />
            )}
          </div>
        </div>
      </div>
      {t.description && !editing && <p className={styles.desc}>{t.description}</p>}
      {showTakeable && t.blockedBy.length > 0 && (
        <div>
          <span className="muted" style={{ fontSize: 13 }}>
            Şunların teslimini bekliyor:
          </span>
          <ul className={styles.waits}>
            {t.blockedBy.map((b) => (
              <li key={b.id}>
                {b.title} · {b.areaName}
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && (
        <div className={styles.form}>
          <div className="field">
            <label className="label" htmlFor={`${tid}-title`}>
              Başlık
            </label>
            <input
              id={`${tid}-title`}
              className="input"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${tid}-desc`}>
              Açıklama
            </label>
            <textarea
              id={`${tid}-desc`}
              className="textarea"
              rows={4}
              value={desc}
              maxLength={5000}
              onChange={(e) => setDesc(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn-solid" onClick={save} disabled={pending || title.trim().length < 2}>
              Kaydet
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setTitle(t.title);
                setDesc(t.description);
                setError(null);
              }}
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {editable && !editing && (
        <div className={styles.actions}>
          {confirming ? (
            <>
              <span className="muted" style={{ alignSelf: "center" }}>
                Bu ticket iptal edilsin mi?
              </span>
              <button type="button" className="btn-line btn-danger" onClick={cancel} disabled={pending}>
                Evet, iptal et
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
                Vazgeç
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-line" onClick={() => setEditing(true)} disabled={pending}>
                Düzenle
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirming(true)} disabled={pending}>
                İptal et
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
