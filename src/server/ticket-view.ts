/** Ticket görünümleri: ayrıntı sayfası, alan takibi, açık talepler. Yazma yapmaz. */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import {
  areas,
  channels,
  evaluations,
  files,
  messages,
  sprints,
  submissions,
  ticketRequests,
  tickets,
} from "@/db/schema";
import { canManageArea, requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { AppError, forbidden, notFound } from "@/lib/contracts/errors";
import type { SprintRow, UserOption } from "@/lib/contracts/plan";
import {
  IN_PROGRESS_STATUSES,
  isEvaluable,
  isSubmittable,
  MAX_GRANTED_HOURS,
  MAX_SUBMISSION_FILES,
  MAX_SUBMISSION_LINKS,
  ticketRefSchema,
  type AreaTrackingView,
  type EvaluationRow,
  type FileRef,
  type OpenRequestRow,
  type RequestRow,
  type SubmissionRow,
  type TicketDetail,
  type TicketMessage,
  type TicketPerms,
  type TrackingRow,
  type Verdict,
} from "@/lib/contracts/tickets";
import { getSettings } from "@/lib/settings";
import { isOfferExpired, offerExpiresAt } from "@/lib/ticket-time";
import { loadPrerequisites } from "./dependencies";
import { loadSubmissionPullRequests } from "./delivery";
import { iso, requireAreaViewer, resolveSprint, toSprintRow } from "./plan-common";
import {
  areaNames,
  canViewTicket,
  loadUsers,
  rejectionQuota,
  toCountdown,
  toTicketCard,
  type RequestDbRow,
  type TicketRow,
} from "./ticket-common";
import { z } from "zod";

export const unknownUser = (id: string): UserOption => ({ id, name: "Bilinmeyen kullanıcı", username: "" });

function toRequestRow(r: RequestDbRow, users: Map<string, UserOption>): RequestRow {
  return {
    id: r.id,
    ticketId: r.ticketId,
    kind: r.kind,
    status: r.status,
    reason: r.reason,
    requester: users.get(r.requesterId) ?? unknownUser(r.requesterId),
    grantedHours: r.grantedHours,
    respondedBy: r.respondedById ? (users.get(r.respondedById) ?? unknownUser(r.respondedById)) : null,
    respondedAt: iso(r.respondedAt),
    responseNote: r.responseNote,
    respondBy: r.respondBy.toISOString(),
    awaitingRequesterAt: iso(r.awaitingRequesterAt),
    overdueAt: iso(r.overdueAt),
    createdAt: r.createdAt.toISOString(),
  };
}

/** Cevapsızlar önce, sonra cevap süresi yakın olan. */
function sortOpenRequests<T extends { overdueAt: string | null; respondBy: string }>(rows: T[]): T[] {
  return rows.sort((x, y) => {
    const ox = x.overdueAt ? 0 : 1;
    const oy = y.overdueAt ? 0 : 1;
    if (ox !== oy) return ox - oy;
    return x.respondBy.localeCompare(y.respondBy);
  });
}

/** Bekleyen talep satırlarını (ticket'larıyla) görünüm satırlarına çevirir. */
export async function toOpenRows(
  db: DbOrTx,
  rows: { request: RequestDbRow; ticket: TicketRow }[],
): Promise<OpenRequestRow[]> {
  const users = await loadUsers(
    db,
    rows.flatMap((r) => [r.request.requesterId, r.request.respondedById]),
  );
  const names = await areaNames(
    db,
    rows.map((r) => r.ticket.areaId),
  );
  return sortOpenRequests(
    rows.map(({ request, ticket }) => ({
      ...toRequestRow(request, users),
      ticket: {
        id: ticket.id,
        title: ticket.title,
        areaId: ticket.areaId,
        areaName: names.get(ticket.areaId) ?? "",
        countdown: toCountdown(ticket),
      },
    })),
  );
}

export async function getTicketDetail(
  db: DB,
  actor: Actor | null,
  raw: { ticketId: string },
  now: Date = new Date(),
): Promise<TicketDetail> {
  const a = requireActor(actor);
  const input = ticketRefSchema.parse(raw);
  const [t] = await db.select().from(tickets).where(eq(tickets.id, input.ticketId)).limit(1);
  if (!t) throw notFound("Ticket bulunamadı.");
  if (!canViewTicket(a, t)) throw forbidden("Bu ticket'ı görme yetkin yok.");

  const settings = await getSettings(db);
  const [sprint] = await db.select({ name: sprints.name }).from(sprints).where(eq(sprints.id, t.sprintId)).limit(1);
  const names = await areaNames(db, [t.areaId]);
  const prereqs = (await loadPrerequisites(db, [t.id])).get(t.id) ?? [];

  const requestRows = await db
    .select()
    .from(ticketRequests)
    .where(eq(ticketRequests.ticketId, t.id))
    .orderBy(desc(ticketRequests.createdAt));
  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.kind, "ticket"), eq(channels.ticketId, t.id)))
    .limit(1);
  const messageRows = channel
    ? await db.select().from(messages).where(eq(messages.channelId, channel.id)).orderBy(asc(messages.createdAt))
    : [];
  const submissionRows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.ticketId, t.id))
    .orderBy(desc(submissions.createdAt));
  const fileRows = submissionRows.length
    ? await db
        .select()
        .from(files)
        .where(
          inArray(
            files.submissionId,
            submissionRows.map((s) => s.id),
          ),
        )
        .orderBy(asc(files.createdAt))
    : [];
  const evalRows = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.ticketId, t.id))
    .orderBy(desc(evaluations.createdAt));

  const users = await loadUsers(db, [
    t.assigneeId,
    ...requestRows.flatMap((r) => [r.requesterId, r.respondedById]),
    ...messageRows.map((m) => m.authorId),
    ...submissionRows.map((s) => s.userId),
    ...evalRows.map((e) => e.evaluatorId),
  ]);
  const userOf = (id: string) => users.get(id) ?? unknownUser(id);

  const requests = requestRows.map((r) => toRequestRow(r, users));
  const pendingRequest = requests.find((r) => r.status === "pending") ?? null;

  const filesBySubmission = new Map<string, FileRef[]>();
  for (const f of fileRows) {
    if (!f.submissionId) continue;
    const arr = filesBySubmission.get(f.submissionId) ?? [];
    arr.push({ id: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes });
    filesBySubmission.set(f.submissionId, arr);
  }

  const messageViews: TicketMessage[] = messageRows.map((m) => ({
    id: m.id,
    kind: m.kind,
    author: m.authorId ? userOf(m.authorId) : null,
    body: m.body,
    requestId: m.requestId,
    createdAt: m.createdAt.toISOString(),
  }));
  const prBySubmission = await loadSubmissionPullRequests(
    db,
    submissionRows.map((s) => s.id),
  );
  const submissionViews: SubmissionRow[] = submissionRows.map((s) => ({
    id: s.id,
    user: userOf(s.userId),
    description: s.description,
    links: s.links,
    files: filesBySubmission.get(s.id) ?? [],
    pullRequest: prBySubmission.get(s.id) ?? null,
    createdAt: s.createdAt.toISOString(),
  }));
  const evaluationViews: EvaluationRow[] = evalRows.map((e) => ({
    id: e.id,
    evaluator: userOf(e.evaluatorId),
    verdict: e.verdict,
    comment: e.comment,
    submissionId: e.submissionId,
    createdAt: e.createdAt.toISOString(),
  }));

  const isAssignee = t.assigneeId === a.id;
  const canManage = canManageArea(a, t.areaId);
  const isRequester = !!pendingRequest && pendingRequest.requester.id === a.id;
  const canRespond = !!pendingRequest && canManage && !isRequester;
  const offerLive = t.status === "offered" && !!t.offeredAt && !isOfferExpired(t.offeredAt, now);
  const perms: TicketPerms = {
    isAssignee,
    canManage,
    canAnswerOffer: isAssignee && offerLive,
    canRequestExtension: isAssignee && t.status === "taken",
    canRequestWithdrawal: isAssignee && t.status === "taken",
    canSubmit: isAssignee && isSubmittable(t.status),
    canEvaluate: canManage && !isAssignee && isEvaluable(t.status),
    canRespond,
    canMessage: !!pendingRequest && (isRequester || canRespond),
    canCancelRequest: isRequester,
  };

  return {
    ticket: {
      ...toTicketCard(t, names.get(t.areaId) ?? ""),
      description: t.description,
      sprintName: sprint?.name ?? "",
      assignee: t.assigneeId ? userOf(t.assigneeId) : null,
      offeredAt: iso(t.offeredAt),
      offerExpiresAt: t.offeredAt ? offerExpiresAt(t.offeredAt).toISOString() : null,
    },
    prerequisites: prereqs,
    requests,
    pendingRequest,
    messages: messageViews,
    submissions: submissionViews,
    evaluations: evaluationViews,
    rejections:
      isAssignee && t.status === "offered"
        ? await rejectionQuota(db, a.id, t.sprintId, settings.rejectionsPerSprint)
        : null,
    perms,
    limits: {
      uploadMaxMb: settings.uploadMaxMb,
      maxLinks: MAX_SUBMISSION_LINKS,
      maxFiles: MAX_SUBMISSION_FILES,
      maxGrantedHours: MAX_GRANTED_HOURS,
    },
  };
}

const areaTrackingSchema = z.object({ areaId: z.uuid(), sprintId: z.uuid().nullish() });

export async function getAreaTracking(
  db: DB,
  actor: Actor | null,
  raw: { areaId: string; sprintId?: string | null },
  now: Date = new Date(),
): Promise<AreaTrackingView> {
  void now;
  const input = areaTrackingSchema.parse(raw);
  const { area } = await requireAreaViewer(db, actor, input.areaId);

  let sprintRow: SprintRow | null = null;
  try {
    sprintRow = toSprintRow(await resolveSprint(db, input.sprintId));
  } catch (e) {
    // Sprint hiç yoksa boş görünüm; açıkça istenen sprint yoksa hata kalır.
    if (!(e instanceof AppError && e.code === "NOT_FOUND") || input.sprintId) throw e;
  }

  const counts = { draft: 0, pool: 0, offered: 0, inProgress: 0, submitted: 0, evaluated: 0, cancelled: 0 };
  let tracked: TicketRow[] = [];
  if (sprintRow) {
    const rows = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.areaId, area.id), eq(tickets.sprintId, sprintRow.id)))
      .orderBy(asc(tickets.dueAt), asc(tickets.title));
    for (const r of rows) {
      if (r.status === "draft") counts.draft++;
      else if (r.status === "available" || r.status === "returned_to_pool") counts.pool++;
      else if (r.status === "offered") counts.offered++;
      else if ((IN_PROGRESS_STATUSES as readonly string[]).includes(r.status)) counts.inProgress++;
      else if (r.status === "submitted") counts.submitted++;
      else if (r.status === "evaluated") counts.evaluated++;
      else if (r.status === "cancelled") counts.cancelled++;
    }
    tracked = rows.filter(
      (r) => r.status === "offered" || r.status === "submitted" || r.status === "evaluated" || (IN_PROGRESS_STATUSES as readonly string[]).includes(r.status),
    );
  }

  // Bu alanın bekleyen talepleri (tüm sprintler).
  const pendingJoined = await db
    .select({ request: ticketRequests, ticket: tickets })
    .from(ticketRequests)
    .innerJoin(tickets, eq(tickets.id, ticketRequests.ticketId))
    .where(and(eq(tickets.areaId, area.id), eq(ticketRequests.status, "pending")));
  const pendingRequests = await toOpenRows(db, pendingJoined);

  const ids = tracked.map((t) => t.id);
  const pendingByTicket = new Map(pendingJoined.map((p) => [p.ticket.id, p.request]));
  const subRows = ids.length
    ? await db
        .select({ ticketId: submissions.ticketId, createdAt: submissions.createdAt })
        .from(submissions)
        .where(inArray(submissions.ticketId, ids))
        .orderBy(desc(submissions.createdAt))
    : [];
  const lastSubmitted = new Map<string, Date>();
  for (const s of subRows) if (!lastSubmitted.has(s.ticketId)) lastSubmitted.set(s.ticketId, s.createdAt);
  const evalRows = ids.length
    ? await db
        .select({ ticketId: evaluations.ticketId, verdict: evaluations.verdict })
        .from(evaluations)
        .where(inArray(evaluations.ticketId, ids))
        .orderBy(asc(evaluations.createdAt))
    : [];
  const verdicts = new Map<string, Verdict[]>();
  for (const e of evalRows) verdicts.set(e.ticketId, [...(verdicts.get(e.ticketId) ?? []), e.verdict]);
  const users = await loadUsers(
    db,
    tracked.map((t) => t.assigneeId),
  );

  const toRow = (t: TicketRow): TrackingRow => {
    const p = pendingByTicket.get(t.id);
    return {
      ...toTicketCard(t, area.name),
      assignee: t.assigneeId ? (users.get(t.assigneeId) ?? unknownUser(t.assigneeId)) : null,
      pendingRequest: p ? { id: p.id, kind: p.kind, overdue: !!p.overdueAt } : null,
      lastSubmittedAt: iso(lastSubmitted.get(t.id)),
      verdicts: verdicts.get(t.id) ?? [],
    };
  };

  const inProgress = tracked
    .filter((t) => t.status !== "submitted" && t.status !== "evaluated")
    .sort((x, y) => (x.dueAt?.getTime() ?? Infinity) - (y.dueAt?.getTime() ?? Infinity))
    .map(toRow);
  const bySubmittedDesc = (x: TicketRow, y: TicketRow) =>
    (lastSubmitted.get(y.id)?.getTime() ?? 0) - (lastSubmitted.get(x.id)?.getTime() ?? 0);
  const toEvaluate = [
    ...tracked.filter((t) => t.status === "submitted").sort(bySubmittedDesc),
    ...tracked.filter((t) => t.status === "evaluated").sort(bySubmittedDesc),
  ].map(toRow);

  return {
    area: { id: area.id, name: area.name },
    sprint: sprintRow,
    counts,
    inProgress,
    pendingRequests,
    toEvaluate,
  };
}

/** Ana yönetici: tüm bekleyen talepler; alan yöneticisi: yönettiği alanlarınkiler. */
export async function listOpenRequests(db: DB, actor: Actor | null, now: Date = new Date()): Promise<OpenRequestRow[]> {
  void now;
  const a = requireActor(actor);
  if (!a.isMainAdmin && a.managedAreaIds.length === 0) throw forbidden("Talepleri görme yetkin yok.");
  const rows = await db
    .select({ request: ticketRequests, ticket: tickets })
    .from(ticketRequests)
    .innerJoin(tickets, eq(tickets.id, ticketRequests.ticketId))
    .innerJoin(areas, eq(areas.id, tickets.areaId))
    .where(
      a.isMainAdmin
        ? eq(ticketRequests.status, "pending")
        : and(eq(ticketRequests.status, "pending"), inArray(tickets.areaId, a.managedAreaIds)),
    );
  return toOpenRows(db, rows);
}
