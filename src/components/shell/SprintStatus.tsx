import type { SprintView } from "@/lib/current-sprint";
import { dayPhases, LAMP_LABELS } from "@/lib/sprint";

const PHASE_CLS = { 1: "is-g", 2: "is-y", 3: "is-r" } as const;

/** Başlıktaki lambalar ve gün çubuğu (yalnız gösterim). Mobilde kompakt görünür. */
export function SprintStatus({ sprint, compact = false }: { sprint: SprintView | null; compact?: boolean }) {
  if (!sprint) {
    return (
      <div className="sprint-status sprint-status--none">
        <span className="sprint-status__lamps" aria-hidden="true">
          <span className="lamp" />
          <span className="lamp" />
          <span className="lamp" />
        </span>
        <span>Aktif sprint yok</span>
      </div>
    );
  }
  const phases = dayPhases(sprint.lengthDays);
  return (
    <div className="sprint-status">
      <span className="sprint-status__lamps">
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
              d < sprint.day ? "is-past" : "",
              d === sprint.day ? "is-now" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return <span key={d} className={cls} />;
          })}
        </span>
      )}
      <span className="muted sprint-status__text">
        <span className="sprint-status__long">{sprint.name}, </span>gün {sprint.day} / {sprint.lengthDays}
        {!compact && <span className="sprint-status__long">, {sprint.daysLeft} gün kaldı</span>}
      </span>
    </div>
  );
}
