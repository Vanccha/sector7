/** Ana yönetici paneli: tek çağrıda özet görünüm. Okuma yapar; denetim kaydı yazmaz. */
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { areas, evaluations, roadmaps, sprints, submissions, ticketRequests, tickets, user } from "@/db/schema";
import { requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import type { DashboardAreaRow, DashboardView, RecentEvaluation, StatusCounts } from "@/lib/contracts/admin";
import type { RoadmapStatus, UserOption } from "@/lib/contracts/plan";
import { IN_PROGRESS_STATUSES, type TrackingRow, type Verdict } from "@/lib/contracts/tickets";
import { localDateString, sprintDay } from "@/lib/sprint";
import { countPendingApplications } from "./applications";
import { listAuditLog } from "./audit-log";
import { iso, toSprintRow } from "./plan-common";
import { areaNames, loadUsers, toTicketCard, type TicketRow } from "./ticket-common";
import { listOpenRequests, unknownUser } from "./ticket-view";

const zeroCounts = (): StatusCounts => ({
  draft: 0,
  pool: 0,
  offered: 0,
  inProgress: 0,
  overdue: 0,
  submitted: 0,
  evaluated: 0,
  cancelled: 0,
  total: 0,
});

function addTo(c: StatusCounts, status: string, n: number, overdue: number) {
  if (status === "draft") c.draft += n;
  else if (status === "available" || status === "returned_to_pool") c.pool += n;
  else if (status === "offered") c.offered += n;
  else if ((IN_PROGRESS_STATUSES as readonly string[]).includes(status)) {
    c.inProgress += n;
    c.overdue += overdue;
  } else if (status === "submitted") c.submitted += n;
  else if (status === "evaluated") c.evaluated += n;
  else if (status === "cancelled") c.cancelled += n;
  c.total += n;
}

/** Bekleyen talep cevapsız mı: işaretlenmiş ya da cevap süresi geçmiş (talep sahibi beklenmiyorsa). */
const isRequestOverdue = (
  r: { overdueAt: Date | string | null; respondBy: Date | string; awaitingRequesterAt: Date | string | null },
  now: Date,
) => !!r.overdueAt || (!r.awaitingRequesterAt && new Date(r.respondBy).getTime() <= now.getTime());

/** Ticket satırlarından TrackingRow üretir (toplu; N+1 yok). */
async function toTrackingRows(db: DbOrTx, rows: TicketRow[]): Promise<TrackingRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((t) => t.id);
  const [names, users, pending, subs, evals] = await Promise.all([
    areaNames(db, rows.map((t) => t.areaId)),
    loadUsers(db, rows.map((t) => t.assigneeId)),
    db
      .select({
        id: ticketRequests.id,
        ticketId: ticketRequests.ticketId,
        kind: ticketRequests.kind,
        overdueAt: ticketRequests.overdueAt,
      })
      .from(ticketRequests)
      .where(and(inArray(ticketRequests.ticketId, ids), eq(ticketRequests.status, "pending"))),
    db
      .select({ ticketId: submissions.ticketId, last: sql<string>`max(${submissions.createdAt})` })
      .from(submissions)
      .where(inArray(submissions.ticketId, ids))
      .groupBy(submissions.ticketId),
    db
      .select({ ticketId: evaluations.ticketId, verdict: evaluations.verdict })
      .from(evaluations)
      .where(inArray(evaluations.ticketId, ids))
      .orderBy(asc(evaluations.createdAt)),
  ]);
  const pendingBy = new Map(pending.map((p) => [p.ticketId, p]));
  const lastBy = new Map(subs.map((s) => [s.ticketId, new Date(s.last)]));
  const verdicts = new Map<string, Verdict[]>();
  for (const e of evals) verdicts.set(e.ticketId, [...(verdicts.get(e.ticketId) ?? []), e.verdict]);
  return rows.map((t) => {
    const p = pendingBy.get(t.id);
    return {
      ...toTicketCard(t, names.get(t.areaId) ?? ""),
      assignee: t.assigneeId ? (users.get(t.assigneeId) ?? unknownUser(t.assigneeId)) : null,
      pendingRequest: p ? { id: p.id, kind: p.kind, overdue: !!p.overdueAt } : null,
      lastSubmittedAt: iso(lastBy.get(t.id)),
      verdicts: verdicts.get(t.id) ?? [],
    };
  });
}

export async function getDashboard(db: DB, actor: Actor | null, now: Date = new Date()): Promise<DashboardView> {
  requireMainAdmin(actor);

  const [active] = await db.select().from(sprints).where(eq(sprints.status, "active")).limit(1);
  const sprintRow = active ? toSprintRow(active) : null;
  const day = active ? sprintDay(active.startDate, active.lengthDays, localDateString(now)) : 0;

  const inProgress = [...IN_PROGRESS_STATUSES];
  const overdueCond = and(inArray(tickets.status, inProgress), isNull(tickets.pausedAt), lte(tickets.dueAt, now));

  const [
    areaRows,
    countRows,
    pendingReqRows,
    roadmapRows,
    closing,
    openRequests,
    overdueRows,
    inactiveRows,
    evalCounts,
    recentEvalRows,
    pendingApplications,
    awaitingRow,
    activity,
  ] = await Promise.all([
    db
      .select({ id: areas.id, name: areas.name, managerId: areas.managerId })
      .from(areas)
      .where(isNull(areas.archivedAt))
      .orderBy(asc(areas.name)),
    active
      ? db
          .select({
            areaId: tickets.areaId,
            status: tickets.status,
            n: sql<number>`count(*)::int`,
            overdue: sql<number>`(count(*) filter (where ${overdueCond}))::int`,
          })
          .from(tickets)
          .where(eq(tickets.sprintId, active.id))
          .groupBy(tickets.areaId, tickets.status)
      : Promise.resolve([]),
    db
      .select({
        areaId: tickets.areaId,
        overdueAt: ticketRequests.overdueAt,
        respondBy: ticketRequests.respondBy,
        awaitingRequesterAt: ticketRequests.awaitingRequesterAt,
      })
      .from(ticketRequests)
      .innerJoin(tickets, eq(tickets.id, ticketRequests.ticketId))
      .where(eq(ticketRequests.status, "pending")),
    active
      ? db.select({ areaId: roadmaps.areaId, status: roadmaps.status }).from(roadmaps).where(eq(roadmaps.sprintId, active.id))
      : Promise.resolve([]),
    db
      .select({
        sprint: sprints,
        undecided: sql<number>`(select count(*) from tickets t where t.sprint_id = "sprints"."id" and t.status not in ('submitted','evaluated','cancelled'))::int`,
      })
      .from(sprints)
      .where(eq(sprints.status, "closing"))
      .orderBy(asc(sprints.number)),
    listOpenRequests(db, actor, now),
    db.select().from(tickets).where(overdueCond).orderBy(asc(tickets.dueAt)).limit(20),
    db
      .select({ t: tickets })
      .from(tickets)
      .innerJoin(user, eq(user.id, tickets.assigneeId))
      .where(and(eq(user.active, false), inArray(tickets.status, ["offered", ...inProgress])))
      .orderBy(asc(tickets.dueAt), asc(tickets.title)),
    active
      ? db
          .select({ verdict: evaluations.verdict, n: sql<number>`count(*)::int` })
          .from(evaluations)
          .innerJoin(tickets, eq(tickets.id, evaluations.ticketId))
          .where(eq(tickets.sprintId, active.id))
          .groupBy(evaluations.verdict)
      : Promise.resolve([]),
    db
      .select({ e: evaluations, ticketTitle: tickets.title, assigneeId: tickets.assigneeId, areaName: areas.name })
      .from(evaluations)
      .innerJoin(tickets, eq(tickets.id, evaluations.ticketId))
      .innerJoin(areas, eq(areas.id, tickets.areaId))
      .orderBy(desc(evaluations.createdAt))
      .limit(10),
    countPendingApplications(db, actor),
    db.select({ n: sql<number>`count(*)::int` }).from(roadmaps).where(eq(roadmaps.status, "submitted")),
    listAuditLog(db, actor, {}),
  ]);

  const totals = zeroCounts();
  const countsByArea = new Map<string, StatusCounts>();
  for (const r of countRows) {
    const c = countsByArea.get(r.areaId) ?? zeroCounts();
    addTo(c, r.status, r.n, r.overdue);
    countsByArea.set(r.areaId, c);
    addTo(totals, r.status, r.n, r.overdue);
  }

  const reqByArea = new Map<string, { pending: number; overdue: number }>();
  for (const r of pendingReqRows) {
    const c = reqByArea.get(r.areaId) ?? { pending: 0, overdue: 0 };
    c.pending++;
    if (isRequestOverdue(r, now)) c.overdue++;
    reqByArea.set(r.areaId, c);
  }
  const roadmapByArea = new Map<string, RoadmapStatus>(roadmapRows.map((r) => [r.areaId, r.status]));

  const managerIds = areaRows.map((a) => a.managerId).filter((x): x is string => !!x);
  const managers = await loadUsers(db, managerIds);
  const activeManagerIds = new Set<string>();
  if (managerIds.length) {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(and(inArray(user.id, managerIds), eq(user.active, true)));
    for (const r of rows) activeManagerIds.add(r.id);
  }

  const areaViews: DashboardAreaRow[] = areaRows.map((a) => {
    const counts = countsByArea.get(a.id) ?? zeroCounts();
    const req = reqByArea.get(a.id) ?? { pending: 0, overdue: 0 };
    return {
      id: a.id,
      name: a.name,
      manager: a.managerId ? (managers.get(a.managerId) ?? null) : null,
      managerMissing: !a.managerId || !activeManagerIds.has(a.managerId),
      counts,
      pendingRequests: req.pending,
      overdueRequests: req.overdue,
      toEvaluate: counts.submitted,
      roadmapStatus: roadmapByArea.get(a.id) ?? null,
    };
  });

  const evalUsers = await loadUsers(db, recentEvalRows.flatMap((r) => [r.assigneeId, r.e.evaluatorId]));
  const recent: RecentEvaluation[] = recentEvalRows.map((r) => {
    const evaluator: UserOption = evalUsers.get(r.e.evaluatorId) ?? unknownUser(r.e.evaluatorId);
    return {
      ticketId: r.e.ticketId,
      ticketTitle: r.ticketTitle,
      areaName: r.areaName,
      assignee: r.assigneeId ? (evalUsers.get(r.assigneeId) ?? unknownUser(r.assigneeId)) : null,
      evaluator,
      verdict: r.e.verdict,
      comment: r.e.comment,
      createdAt: r.e.createdAt.toISOString(),
    };
  });

  const [overdueTickets, inactiveHeld] = await Promise.all([
    toTrackingRows(db, overdueRows),
    toTrackingRows(
      db,
      inactiveRows.map((r) => r.t),
    ),
  ]);

  return {
    sprint: sprintRow && active ? { ...sprintRow, day, daysLeft: Math.max(0, active.lengthDays - day) } : null,
    totals,
    areas: areaViews,
    closingSprints: closing.map((c) => ({ sprint: toSprintRow(c.sprint), undecided: c.undecided })),
    requests: {
      items: openRequests.slice(0, 20),
      pending: openRequests.length,
      overdue: openRequests.filter((r) => isRequestOverdue(r, now)).length,
    },
    overdueTickets,
    inactiveHeld,
    evaluations: {
      good: evalCounts.find((e) => e.verdict === "good")?.n ?? 0,
      bad: evalCounts.find((e) => e.verdict === "bad")?.n ?? 0,
      recent,
    },
    pendingApplications,
    roadmapsAwaiting: awaitingRow[0]?.n ?? 0,
    recentActivity: activity.rows.slice(0, 15),
  };
}
