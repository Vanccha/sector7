import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { roadmaps } from "@/db/schema";
import { SprintPicker } from "@/components/plan/SprintPicker";
import { requirePageActor } from "@/lib/auth/session";
import { ROADMAP_STATUS_LABELS } from "@/lib/contracts/plan";
import { listPlanningSprints, resolveSprint, toSprintRow } from "@/server/plan-common";
import { listAreaTickets } from "@/server/tickets";
import { TicketList } from "./TicketList";
import styles from "./TicketList.module.css";

export const metadata = { title: "Ticket'lar" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function TicketsPage({
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
  const [view, planning, roadmap] = await Promise.all([
    listAreaTickets(db, actor, { areaId, sprintId: sprint.id }),
    listPlanningSprints(db),
    db
      .select({ id: roadmaps.id })
      .from(roadmaps)
      .where(and(eq(roadmaps.areaId, areaId), eq(roadmaps.sprintId, sprint.id)))
      .limit(1),
  ]);
  const sprints = planning.some((s) => s.id === sprint.id) ? planning : [...planning, toSprintRow(sprint)];
  const approved = view.roadmapStatus === "approved";

  return (
    <div className={styles.page}>
      <SprintPicker sprints={sprints} currentId={sprint.id} />
      {!approved ? (
        <p className="notice" role="status">
          Ticket&apos;lara bölmek için roadmap&apos;in onaylanması gerekiyor
          {view.roadmapStatus ? ` (şu an: ${ROADMAP_STATUS_LABELS[view.roadmapStatus]})` : ""}.{" "}
          <Link href={`/alan/${areaId}?sprint=${sprint.id}`}>Plan sekmesine git</Link>
        </p>
      ) : null}
      <TicketList
        key={sprint.id}
        view={view}
        roadmapId={roadmap[0]?.id ?? null}
        approved={approved}
      />
    </div>
  );
}
