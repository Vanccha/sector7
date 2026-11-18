"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/contracts/errors";
import { ROADMAP_STATUS_LABELS, type AreaPlan, type GoalRow, type StepRow } from "@/lib/contracts/plan";
import {
  addStepAction,
  createGoalAction,
  deleteGoalAction,
  deleteStepAction,
  reorderStepsAction,
  submitRoadmapAction,
  updateGoalAction,
  updateStepAction,
} from "./actions";
import styles from "./PlanEditor.module.css";

/** İşlem çalıştırır; hata mesajını ve bekleme durumunu tutar. */
function useAct() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  function act(fn: () => Promise<ActionResult<unknown>>, onOk?: () => void) {
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
  return { pending, error, fields, act };
}

function ErrorLine({ error }: { error: string | null }) {
  return (
    <div aria-live="polite">
      {error && (
        <p className={`notice notice--hot ${styles.errorText}`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function PlanEditor({ plan }: { plan: AreaPlan }) {
  const { roadmap, canEdit } = plan;
  const sprintQuery = `?sprint=${plan.sprint.id}`;
  const submit = useAct();
  const canSubmit = canEdit && (roadmap.status === "draft" || roadmap.status === "returned");

  return (
    <div className={styles.root}>
      {!canEdit && (
        <p className="notice" role="status">
          Bu plan salt okunur: sprint kapanmış ya da alan arşivlenmiş olabilir.
        </p>
      )}

      <section className={`cut-panel ${styles.section}`} aria-labelledby="goals-h">
        <h2 id="goals-h" className={`h-wide ${styles.h2}`}>
          Hedefler
        </h2>
        <GoalList plan={plan} />
      </section>

      <section className={`cut-panel ${styles.section}`} aria-labelledby="roadmap-h">
        <div className={styles.head}>
          <h2 id="roadmap-h" className={`h-wide ${styles.h2}`}>
            Roadmap
          </h2>
          <span
            className={
              roadmap.status === "approved" ? "badge badge--ok" : roadmap.status === "returned" ? "badge badge--hot" : "badge"
            }
          >
            {ROADMAP_STATUS_LABELS[roadmap.status]}
          </span>
        </div>

        {roadmap.status === "returned" && roadmap.reviewNote && (
          <div className="notice notice--hot" role="status">
            <strong>Ana yöneticinin notu</strong>
            <p className={styles.text}>{roadmap.reviewNote}</p>
          </div>
        )}
        {roadmap.status === "approved" && (
          <div className="notice notice--ok" role="status">
            <p className={styles.text}>Roadmap onaylandı. Basamakları değiştirirsen yeniden onaya gider.</p>
            <p className={styles.text}>
              <Link href={`/alan/${plan.area.id}/ticketlar${sprintQuery}`}>Ticket&apos;lara böl →</Link>
            </p>
          </div>
        )}
        {roadmap.status === "submitted" && (
          <p className="notice" role="status">
            Roadmap ana yöneticinin onayını bekliyor.
          </p>
        )}

        <StepList plan={plan} />

        {canEdit && <AddStepForm plan={plan} />}

        {canSubmit && (
          <div className={styles.actions}>
            <button
              type="button"
              className="btn-solid"
              disabled={submit.pending || roadmap.steps.length === 0}
              onClick={() =>
                submit.act(() => submitRoadmapAction({ areaId: plan.area.id, sprintId: plan.sprint.id }))
              }
            >
              Onaya gönder
            </button>
            {roadmap.steps.length === 0 && <span className="muted">Önce en az bir basamak ekle.</span>}
          </div>
        )}
        <ErrorLine error={submit.error} />
      </section>
    </div>
  );
}

/* ------------------------------ Hedefler ------------------------------ */

function GoalList({ plan }: { plan: AreaPlan }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <>
      {plan.goals.length === 0 ? (
        <p className="muted">Bu sprint için henüz hedef yok.</p>
      ) : (
        <ul className={styles.list}>
          {plan.goals.map((g) => (
            <li key={g.id} className={styles.item}>
              {editing === g.id ? (
                <GoalForm
                  key={g.id}
                  areaId={plan.area.id}
                  sprintId={plan.sprint.id}
                  goal={g}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <GoalView goal={g} canEdit={plan.canEdit} onEdit={() => setEditing(g.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {plan.canEdit && editing !== "new" && (
        <div className={styles.actions}>
          <button type="button" className="btn-line" onClick={() => setEditing("new")}>
            Hedef ekle
          </button>
        </div>
      )}
      {plan.canEdit && editing === "new" && (
        <GoalForm areaId={plan.area.id} sprintId={plan.sprint.id} onDone={() => setEditing(null)} />
      )}
    </>
  );
}

function GoalView({ goal, canEdit, onEdit }: { goal: GoalRow; canEdit: boolean; onEdit: () => void }) {
  const { pending, error, act } = useAct();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <p className={styles.itemTitle}>{goal.title}</p>
      {goal.requirements && <p className={styles.text}>{goal.requirements}</p>}
      {canEdit && (
        <div className={styles.actions}>
          <button type="button" className="btn-line" onClick={onEdit} disabled={pending}>
            Düzenle
          </button>
          {!confirming && (
            <button type="button" className="btn-ghost" onClick={() => setConfirming(true)} disabled={pending}>
              Sil
            </button>
          )}
        </div>
      )}
      {confirming && (
        <div className="notice" role="group" aria-label="Silme onayı">
          <p className={styles.text}>Bu hedef silinecek; bağlı basamaklar hedefsiz kalır.</p>
          <div className={styles.actions}>
            <button
              type="button"
              className="btn-line"
              disabled={pending}
              onClick={() => act(() => deleteGoalAction({ goalId: goal.id }), () => setConfirming(false))}
            >
              Evet, sil
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </>
  );
}

function GoalForm({
  areaId,
  sprintId,
  goal,
  onDone,
}: {
  areaId: string;
  sprintId: string;
  goal?: GoalRow;
  onDone: () => void;
}) {
  const { pending, error, fields, act } = useAct();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [requirements, setRequirements] = useState(goal?.requirements ?? "");
  const uid = goal?.id ?? "new-goal";
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        act(
          () =>
            goal
              ? updateGoalAction({ goalId: goal.id, title, requirements })
              : createGoalAction({ areaId, sprintId, title, requirements }),
          onDone,
        );
      }}
    >
      <div className="field">
        <label className="label" htmlFor={`${uid}-title`}>
          Hedef nedir
        </label>
        <input
          id={`${uid}-title`}
          className="input"
          value={title}
          maxLength={200}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
        {fields.title && <span className="muted">{fields.title}</span>}
      </div>
      <div className="field">
        <label className="label" htmlFor={`${uid}-req`}>
          Ulaşmak için ne gerekir
        </label>
        <textarea
          id={`${uid}-req`}
          className="textarea"
          rows={3}
          maxLength={5000}
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
        />
      </div>
      <div className={styles.actions}>
        <button type="submit" className="btn-solid" disabled={pending}>
          Kaydet
        </button>
        <button type="button" className="btn-ghost" onClick={onDone} disabled={pending}>
          Vazgeç
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

/* ------------------------------ Basamaklar ----------------------------- */

function StepList({ plan }: { plan: AreaPlan }) {
  const { roadmap, goals, canEdit } = plan;
  const [editing, setEditing] = useState<string | null>(null);
  const reorder = useAct();
  if (roadmap.steps.length === 0) return <p className="muted">Henüz basamak yok.</p>;

  function move(index: number, dir: -1 | 1) {
    if (!roadmap.id) return;
    const ids = roadmap.steps.map((s) => s.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.act(() => reorderStepsAction({ roadmapId: roadmap.id, stepIds: ids }));
  }

  return (
    <>
      <ol className={styles.list}>
        {roadmap.steps.map((s, i) => (
          <li key={s.id} className={styles.item}>
            {editing === s.id ? (
              <StepForm key={s.id} plan={plan} step={s} onDone={() => setEditing(null)} />
            ) : (
              <StepView
                step={s}
                index={i}
                last={i === roadmap.steps.length - 1}
                goalTitle={goals.find((g) => g.id === s.goalId)?.title ?? null}
                canEdit={canEdit}
                busy={reorder.pending}
                onMove={(d) => move(i, d)}
                onEdit={() => setEditing(s.id)}
              />
            )}
          </li>
        ))}
      </ol>
      <ErrorLine error={reorder.error} />
    </>
  );
}

function StepView({
  step,
  index,
  last,
  goalTitle,
  canEdit,
  busy,
  onMove,
  onEdit,
}: {
  step: StepRow;
  index: number;
  last: boolean;
  goalTitle: string | null;
  canEdit: boolean;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
}) {
  const { pending, error, act } = useAct();
  const [confirming, setConfirming] = useState(false);
  const hasTickets = step.ticketCount > 0;
  const reasonId = `step-${step.id}-reason`;
  return (
    <>
      <p className={styles.itemTitle}>
        <span className={styles.num}>{index + 1}.</span>
        {step.title}
      </p>
      {step.description && <p className={styles.text}>{step.description}</p>}
      <div className={styles.meta}>
        {goalTitle && <span className="chip">Hedef: {goalTitle}</span>}
        <span className="muted">Ticket: {step.ticketCount}</span>
      </div>
      {canEdit && (
        <div className={styles.actions}>
          <button
            type="button"
            className="btn-line"
            onClick={() => onMove(-1)}
            disabled={busy || pending || index === 0}
            aria-label={`${step.title} basamağını yukarı taşı`}
          >
            Yukarı
          </button>
          <button
            type="button"
            className="btn-line"
            onClick={() => onMove(1)}
            disabled={busy || pending || last}
            aria-label={`${step.title} basamağını aşağı taşı`}
          >
            Aşağı
          </button>
          <button type="button" className="btn-line" onClick={onEdit} disabled={pending}>
            Düzenle
          </button>
          {!confirming && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirming(true)}
              disabled={pending || hasTickets}
              aria-describedby={hasTickets ? reasonId : undefined}
            >
              Sil
            </button>
          )}
        </div>
      )}
      {canEdit && hasTickets && (
        <span id={reasonId} className="muted">
          Bu basamaktan ticket oluşturulmuş; silinemez.
        </span>
      )}
      {confirming && (
        <div className="notice" role="group" aria-label="Silme onayı">
          <p className={styles.text}>Bu basamak silinecek. Onaylı roadmap ise yeniden onaya gider.</p>
          <div className={styles.actions}>
            <button
              type="button"
              className="btn-line"
              disabled={pending}
              onClick={() => act(() => deleteStepAction({ stepId: step.id }), () => setConfirming(false))}
            >
              Evet, sil
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </>
  );
}

function GoalSelect({
  id,
  goals,
  value,
  onChange,
}: {
  id: string;
  goals: GoalRow[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        Bağlı hedef (isteğe bağlı)
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Hedef seçilmedi</option>
        {goals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function StepForm({ plan, step, onDone }: { plan: AreaPlan; step: StepRow; onDone: () => void }) {
  const { pending, error, fields, act } = useAct();
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [goalId, setGoalId] = useState(step.goalId ?? "");
  const uid = `edit-${step.id}`;
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        act(() => updateStepAction({ stepId: step.id, title, description, goalId: goalId || null }), onDone);
      }}
    >
      <div className="field">
        <label className="label" htmlFor={`${uid}-title`}>
          Başlık
        </label>
        <input
          id={`${uid}-title`}
          className="input"
          value={title}
          maxLength={200}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
        {fields.title && <span className="muted">{fields.title}</span>}
      </div>
      <div className="field">
        <label className="label" htmlFor={`${uid}-desc`}>
          Açıklama
        </label>
        <textarea
          id={`${uid}-desc`}
          className="textarea"
          rows={3}
          maxLength={5000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <GoalSelect id={`${uid}-goal`} goals={plan.goals} value={goalId} onChange={setGoalId} />
      <div className={styles.actions}>
        <button type="submit" className="btn-solid" disabled={pending}>
          Kaydet
        </button>
        <button type="button" className="btn-ghost" onClick={onDone} disabled={pending}>
          Vazgeç
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

function AddStepForm({ plan }: { plan: AreaPlan }) {
  const { pending, error, fields, act } = useAct();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goalId, setGoalId] = useState("");
  return (
    <form
      className={styles.form}
      aria-label="Basamak ekle"
      onSubmit={(e) => {
        e.preventDefault();
        act(
          () =>
            addStepAction({
              areaId: plan.area.id,
              sprintId: plan.sprint.id,
              title,
              description,
              goalId: goalId || null,
            }),
          () => {
            setTitle("");
            setDescription("");
            setGoalId("");
          },
        );
      }}
    >
      <h3 className="h-wide" style={{ margin: 0, fontSize: "1rem" }}>
        Basamak ekle
      </h3>
      <div className="field">
        <label className="label" htmlFor="add-step-title">
          Başlık
        </label>
        <input
          id="add-step-title"
          className="input"
          value={title}
          maxLength={200}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
        {fields.title && <span className="muted">{fields.title}</span>}
      </div>
      <div className="field">
        <label className="label" htmlFor="add-step-desc">
          Açıklama
        </label>
        <textarea
          id="add-step-desc"
          className="textarea"
          rows={3}
          maxLength={5000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <GoalSelect id="add-step-goal" goals={plan.goals} value={goalId} onChange={setGoalId} />
      <div className={styles.actions}>
        <button type="submit" className="btn-line" disabled={pending}>
          Basamak ekle
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}
