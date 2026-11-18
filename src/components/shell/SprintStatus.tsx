import type { SprintView } from "@/lib/current-sprint";
import { dayPhases, LAMP_LABELS } from "@/lib/sprint";

const PHASE_CLS = { 1: "is-g", 2: "is-y", 3: "is-r" } as const;

/** Başlıktaki lambalar ve gün çubuğu (yalnız gösterim). */
export function SprintStatus({ sprint, compact = false }: { sprint: SprintView | null; compact?: boolean }) {
  if (!sprint) return <span className="muted" style={{ fontSize: 14 }}>Aktif sprint yok</span>;
  const phases = dayPhases(sprint.lengthDays);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", alignItems: "center", fontSize: 14 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span className={sprint.lamp === "green" ? "lamp is-g" : "lamp"} aria-hidden="true" />
        <span className={sprint.lamp === "yellow" ? "lamp is-y" : "lamp"} aria-hidden="true" />
        <span className={sprint.lamp === "red" ? "lamp is-r" : "lamp"} aria-hidden="true" />
        <span className="sr-only">Sprint durumu: {LAMP_LABELS[sprint.lamp]}</span>
      </span>
      {!compact && (
        <span className="days" aria-hidden="true">
          {phases.map((ph, i) => {
            const d = i + 1;
            const prev = phases[i - 1];
            const cls = [
              "dy",
              i > 0 && prev !== ph ? "wk" : "",
              d <= sprint.day ? PHASE_CLS[ph] : "",
              d === sprint.day ? "is-now" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return <span key={d} className={cls} />;
          })}
        </span>
      )}
      <span className="muted">
        {sprint.name}, gün {sprint.day} / {sprint.lengthDays}
        {!compact && <>, {sprint.daysLeft} gün kaldı</>}
      </span>
    </div>
  );
}
