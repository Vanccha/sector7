import { db } from "@/db";
import { SprintPicker } from "@/components/plan/SprintPicker";
import { requirePageActor } from "@/lib/auth/session";
import { listPlanningSprints, resolveSprint, toSprintRow } from "@/server/plan-common";
import { listAreaTickets } from "@/server/tickets";
import { DependencyWorkspace } from "./DependencyWorkspace";
import styles from "./Dependency.module.css";

export const metadata = { title: "Bağımlılıklar" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function DependenciesPage({
  params,
  searchParams,
}: {
  params: Promise<{ areaId: string }>;
  searchParams: Promise<{ sprint?: string | string[] }>;
}) {
  const { areaId } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.sprint) ? sp.sprint[0] : sp.sprint;
  const actor = await requirePageActor();
  const sprint = await resolveSprint(db, raw && UUID.test(raw) ? raw : null);
  const [view, planning] = await Promise.all([
    listAreaTickets(db, actor, { areaId, sprintId: sprint.id }),
    listPlanningSprints(db),
  ]);
  const sprints = planning.some((s) => s.id === sprint.id) ? planning : [...planning, toSprintRow(sprint)];
  return (
    <div className={styles.page}>
      <SprintPicker sprints={sprints} currentId={sprint.id} />
      <DependencyWorkspace
        key={sprint.id}
        tickets={view.tickets}
        externalPrerequisites={view.externalPrerequisites}
        canEdit={view.canEdit}
      />
    </div>
  );
}
