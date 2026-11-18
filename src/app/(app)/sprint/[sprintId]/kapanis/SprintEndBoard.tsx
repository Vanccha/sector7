"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Countdown } from "@/components/tickets/Countdown";
import { TICKET_STATUS_LABELS } from "@/lib/contracts/plan";
import type { SprintEndItem, SprintEndView } from "@/lib/contracts/tickets";
import { closeSprintAction, decideSprintEndAction } from "./actions";

const list = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 } as const;

export function SprintEndBoard({ view, isMainAdmin }: { view: SprintEndView; isMainAdmin: boolean }) {
  const { sprint, nextSprint, items, undecidedTotal } = view;
  const open = items.filter((i) => !i.decision);
  const decided = items.filter((i) => i.decision);
  const byArea = new Map<string, SprintEndItem[]>();
  for (const i of open) {
    const k = i.ticket.areaName;
    byArea.set(k, [...(byArea.get(k) ?? []), i]);
  }
  const closed = sprint.status === "closed";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 820 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Sprint kapanışı
        </span>
        <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
          {sprint.name}
        </h1>
        <p style={{ margin: 0 }} aria-live="polite">
          {closed ? "Bu sprint kapandı." : `${undecidedTotal} ticket karar bekliyor`}
        </p>
      </header>

      {nextSprint ? (
        <p className="notice" style={{ margin: 0 }}>
          Taşınanlar buraya gider: <strong>{nextSprint.name}</strong>
        </p>
      ) : (
        <p className="notice notice--hot" role="status" style={{ margin: 0 }}>
          Sonraki sprint yok; taşıma seçenekleri için önce Yönetim → Sprintler&apos;den yeni sprint planla.
          {isMainAdmin && (
            <>
              {" "}
              <Link href="/yonetim/sprintler">Sprintler&apos;e git</Link>
            </>
          )}
        </p>
      )}

      {!closed && open.length === 0 && (
        <p className="cut-panel" style={{ padding: 16, margin: 0 }}>
          {undecidedTotal === 0
            ? "Karar bekleyen ticket kalmadı."
            : "Senin alanlarında karar bekleyen ticket yok; kalanlar başka alanlarda."}
        </p>
      )}

      {[...byArea.entries()].map(([areaName, rows]) => (
        <section key={areaName} aria-label={`${areaName} alanı`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="h-wide" style={{ margin: 0, fontSize: 18 }}>
            {areaName}
          </h2>
          <ul style={list}>
            {rows.map((it) => (
              <li key={it.ticket.id}>
                <DecisionCard item={it} view={view} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {decided.length > 0 && (
        <section aria-labelledby="verilen" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="verilen" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
            Karar verilenler
          </h2>
          <ul style={list}>
            {decided.map((it) => (
              <li key={it.ticket.id} className="cut-panel" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="chip-title">{it.ticket.title}</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {it.ticket.areaName} · {it.decision!.decidedBy.name}
                </span>
                <span className="chip-meta">{it.decision!.label}</span>
                {it.decision!.note && <span style={{ fontSize: 14 }}>Not: {it.decision!.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isMainAdmin && !closed && <CloseBlock view={view} />}
    </div>
  );
}

function DecisionCard({ item, view }: { item: SprintEndItem; view: SprintEndView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = item.ticket;
  const id = `t-${t.id}`;
  const options = view.options.filter((o) => item.allowedOptions.includes(o.key));

  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!choice) {
      setError("Önce bir seçenek seç.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await decideSprintEndAction({
        sprintId: view.sprint.id,
        ticketId: t.id,
        decision: choice,
        note: note.trim() || undefined,
      });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <form className="cut-panel" onSubmit={apply} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }} disabled={!item.canDecide || pending}>
        <legend className="chip-title" style={{ padding: 0, marginBottom: 6 }}>
          {t.title}
        </legend>
        <div className="chip-row" style={{ flexWrap: "wrap" }}>
          <span className="chip-meta">{TICKET_STATUS_LABELS[t.status]}</span>
          <span>{t.assignee ? t.assignee.name : "Kimse yok"}</span>
          <Countdown countdown={t.countdown} size="sm" />
        </div>
        {!item.canDecide ? (
          <p className="muted" style={{ margin: 0 }}>
            Bu ticket için karar verme yetkin yok; yalnız görüntüleyebilirsin.
          </p>
        ) : (
          <>
            {options.map((o) => {
              const blocked = o.needsNextSprint && !view.nextSprint;
              return (
                <label
                  key={o.key}
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 44, padding: "6px 0", opacity: blocked ? 0.55 : 1 }}
                >
                  <input
                    type="radio"
                    name={`${id}-choice`}
                    value={o.key}
                    checked={choice === o.key}
                    onChange={() => setChoice(o.key)}
                    disabled={blocked}
                    style={{ marginTop: 4, width: 20, height: 20 }}
                  />
                  <span>
                    <strong>{o.label}</strong>
                    <br />
                    <span className="muted" style={{ fontSize: 13 }}>
                      {o.description}
                      {blocked ? " (önce sonraki sprint planlanmalı)" : ""}
                    </span>
                  </span>
                </label>
              );
            })}
            <div className="field">
              <label className="label" htmlFor={`${id}-note`}>
                Not (isteğe bağlı)
              </label>
              <input
                id={`${id}-note`}
                className="input"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button type="submit" className="btn-solid">
                Uygula
              </button>
              <span className="muted" style={{ fontSize: 13 }}>
                Karar hemen uygulanır, geri alınamaz.
              </span>
            </div>
          </>
        )}
      </fieldset>
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function CloseBlock({ view }: { view: SprintEndView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    startTransition(async () => {
      const res = await closeSprintAction({ sprintId: view.sprint.id });
      if (res.ok) router.push("/yonetim/sprintler");
      else setError(res.error);
    });
  }

  return (
    <section aria-labelledby="kapat" className="cut-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 id="kapat" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
        Sprinti kapat
      </h2>
      {!view.canClose && (
        <p className="muted" style={{ margin: 0 }} id="kapat-neden">
          {view.undecidedTotal} ticket için karar bekleniyor; hepsi karara bağlanınca sprint kapatılabilir.
        </p>
      )}
      <div>
        <button
          type="button"
          className="btn-solid"
          onClick={close}
          disabled={!view.canClose || pending}
          aria-describedby={view.canClose ? undefined : "kapat-neden"}
        >
          Sprinti kapat
        </button>
      </div>
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
