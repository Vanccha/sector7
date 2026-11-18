"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SPRINT_STATUS_LABELS, type SprintRow } from "@/lib/contracts/plan";

/** Alan sayfalarında sprint seçimi: `?sprint=<id>` sorgusunu değiştirir. */
export function SprintPicker({ sprints, currentId }: { sprints: SprintRow[]; currentId: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  if (sprints.length <= 1) return null;
  return (
    <div className="field" style={{ maxWidth: 320 }}>
      <label className="label" htmlFor="sprint-picker">
        Sprint
      </label>
      <select
        id="sprint-picker"
        className="select"
        value={currentId}
        onChange={(e) => {
          const q = new URLSearchParams(sp.toString());
          q.set("sprint", e.target.value);
          router.push(`${path}?${q}`);
        }}
      >
        {sprints.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {SPRINT_STATUS_LABELS[s.status]}
          </option>
        ))}
      </select>
    </div>
  );
}
