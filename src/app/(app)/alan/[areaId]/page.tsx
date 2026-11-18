import { db } from "@/db";
import { SprintPicker } from "@/components/plan/SprintPicker";
import { requirePageActor } from "@/lib/auth/session";
import { getAreaPlan } from "@/server/plan";
import { listPlanningSprints } from "@/server/plan-common";
import { PlanEditor } from "./PlanEditor";

export const metadata = { title: "Hedef ve roadmap" };

export default async function AreaPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ areaId: string }>;
  searchParams: Promise<{ sprint?: string | string[] }>;
}) {
  const { areaId } = await params;
  const sp = await searchParams;
  const sprintParam = Array.isArray(sp.sprint) ? sp.sprint[0] : sp.sprint;
  const actor = await requirePageActor();
  const plan = await getAreaPlan(db, actor, { areaId, sprintId: sprintParam || undefined });
  const sprints = await listPlanningSprints(db);
  if (!sprints.some((s) => s.id === plan.sprint.id)) sprints.push(plan.sprint);
  return (
    <>
      <SprintPicker sprints={sprints} currentId={plan.sprint.id} />
      <PlanEditor plan={plan} />
    </>
  );
}
