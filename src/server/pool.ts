/** Havuz: ticket isteme (rastgele çekme), teklifi kabul/ret ve kişinin kendi ticket'ları. */
import { and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { areas, evaluations, ticketRejections, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { invalidState } from "@/lib/contracts/errors";
import {
  IN_PROGRESS_STATUSES,
  ticketRefSchema,
  type DrawResult,
  type MyTicketsView,
  type OfferView,
  type RejectionQuota,
  type Verdict,
} from "@/lib/contracts/tickets";
import { getSettings } from "@/lib/settings";
import { addHours, isOfferExpired, offerExpiresAt } from "@/lib/ticket-time";
import { takeableCondition } from "./dependencies";
import { assertGithubLinkedForTickets } from "./github-link";
import {
  areaNames,
  getActiveSprint,
  lockTicket,
  RELEASE_FIELDS,
  rejectionQuota,
  toTicketCard,
  type TicketRow,
} from "./ticket-common";

function toOfferView(t: TicketRow, areaName: string): OfferView {
  if (!t.offeredAt) throw new Error("Teklif zamanı eksik.");
  return {
    ticket: { ...toTicketCard(t, areaName), description: t.description },
    offeredAt: t.offeredAt.toISOString(),
    expiresAt: offerExpiresAt(t.offeredAt).toISOString(),
  };
}

async function areaNameOf(db: DbOrTx, areaId: string): Promise<string> {
  return (await areaNames(db, [areaId])).get(areaId) ?? "";
}

/** Ticket iste: ticket kişiye teklif olarak (red hakkı varsa) ya da doğrudan atanarak düşer. */
export async function requestTicket(db: DB, actor: Actor | null, now: Date = new Date()): Promise<DrawResult> {
  const a = requireActor(actor);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"ticket-request:" + a.id}))`);
    const sprint = await getActiveSprint(tx);
    if (!sprint) throw invalidState("Şu an aktif sprint yok; ticket istenemez.");
    const settings = await getSettings(tx);
    const quotaOf = () => rejectionQuota(tx, a.id, sprint.id, settings.rejectionsPerSprint);

    // Bekleyen teklif var mı?
    const [pending] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.status, "offered"), eq(tickets.assigneeId, a.id)))
      .for("update")
      .limit(1);
    if (pending) {
      if (pending.offeredAt && !isOfferExpired(pending.offeredAt, now)) {
        return {
          kind: "offered",
          offer: toOfferView(pending, await areaNameOf(tx, pending.areaId)),
          rejections: await quotaOf(),
        };
      }
      // Süresi geçmiş teklif: hak düşmeden havuza dön.
      await tx.update(tickets).set({ ...RELEASE_FIELDS, updatedAt: now }).where(eq(tickets.id, pending.id));
      await audit(tx, {
        actorId: a.id,
        action: "ticket.offer_expired",
        entityType: "ticket",
        entityId: pending.id,
        areaId: pending.areaId,
        ticketId: pending.id,
        data: { reason: "lazy" },
      });
    }

    // Red hakkı bittiyse ticket doğrudan atanacak: bağlı GitHub hesabı yoksa ticket çekmeden reddet.
    const quota = await quotaOf();
    if (quota.remaining <= 0) await assertGithubLinkedForTickets(tx, a.id);

    // Aday seçimi.
    const rejectedRows = await tx
      .select({ ticketId: ticketRejections.ticketId })
      .from(ticketRejections)
      .where(and(eq(ticketRejections.userId, a.id), eq(ticketRejections.sprintId, sprint.id)));
    const rejectedIds = rejectedRows.map((r) => r.ticketId);
    const ownAreas = [...new Set([...(a.homeAreaId ? [a.homeAreaId] : []), ...a.managedAreaIds])];

    const conditions: (SQL | undefined)[] = [
      eq(tickets.sprintId, sprint.id),
      isNull(areas.archivedAt),
      takeableCondition(),
      ownAreas.length ? notInArray(tickets.areaId, ownAreas) : undefined,
      rejectedIds.length ? notInArray(tickets.id, rejectedIds) : undefined,
    ];
    const [candidate] = await tx
      .select({ ticket: tickets, areaName: areas.name })
      .from(tickets)
      .innerJoin(areas, eq(areas.id, tickets.areaId))
      .where(and(...conditions))
      .orderBy(sql`random()`)
      .limit(1)
      .for("update", { of: tickets, skipLocked: true });

    if (!candidate) {
      await audit(tx, {
        actorId: a.id,
        action: "ticket.request_draw",
        entityType: "sprint",
        entityId: sprint.id,
        data: { kind: "empty" },
      });
      return { kind: "empty", rejections: quota };
    }

    const t = candidate.ticket;
    if (quota.remaining > 0) {
      const [row] = await tx
        .update(tickets)
        .set({ status: "offered", assigneeId: a.id, offeredAt: now, updatedAt: now })
        .where(eq(tickets.id, t.id))
        .returning();
      if (!row) throw new Error("Ticket güncellenemedi.");
      await audit(tx, {
        actorId: a.id,
        action: "ticket.request_draw",
        entityType: "ticket",
        entityId: t.id,
        areaId: t.areaId,
        ticketId: t.id,
        data: { kind: "offered" },
      });
      return { kind: "offered", offer: toOfferView(row, candidate.areaName), rejections: quota };
    }

    const [row] = await tx
      .update(tickets)
      .set({
        status: "taken",
        assigneeId: a.id,
        takenAt: now,
        dueAt: addHours(now, settings.ticketHours),
        offeredAt: null,
        updatedAt: now,
      })
      .where(eq(tickets.id, t.id))
      .returning();
    if (!row) throw new Error("Ticket güncellenemedi.");
    await audit(tx, {
      actorId: a.id,
      action: "ticket.request_draw",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
      data: { kind: "taken" },
    });
    return { kind: "taken", ticket: toTicketCard(row, candidate.areaName), rejections: quota };
  });
}

function assertOwnOffer(t: TicketRow, actorId: string) {
  if (t.status !== "offered" || t.assigneeId !== actorId) throw invalidState("Bu teklif artık geçerli değil.");
}

export async function acceptOffer(db: DB, actor: Actor | null, raw: { ticketId: string }, now: Date = new Date()): Promise<void> {
  const a = requireActor(actor);
  const input = ticketRefSchema.parse(raw);
  await db.transaction(async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    assertOwnOffer(t, a.id);
    if (!t.offeredAt || isOfferExpired(t.offeredAt, now)) {
      throw invalidState("Teklifin süresi doldu; yeni ticket isteyebilirsin.");
    }
    await assertGithubLinkedForTickets(tx, a.id);
    const settings = await getSettings(tx);
    await tx
      .update(tickets)
      .set({ status: "taken", takenAt: now, dueAt: addHours(now, settings.ticketHours), offeredAt: null, updatedAt: now })
      .where(eq(tickets.id, t.id));
    await audit(tx, {
      actorId: a.id,
      action: "ticket.offer_accept",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
    });
  });
}

export async function rejectOffer(
  db: DB,
  actor: Actor | null,
  raw: { ticketId: string },
  now: Date = new Date(),
): Promise<RejectionQuota> {
  const a = requireActor(actor);
  const input = ticketRefSchema.parse(raw);
  return db.transaction(async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    assertOwnOffer(t, a.id);
    const settings = await getSettings(tx);
    const before = await rejectionQuota(tx, a.id, t.sprintId, settings.rejectionsPerSprint);
    if (before.remaining <= 0) throw invalidState("Bu sprintte red hakkın kalmadı.");
    await tx.insert(ticketRejections).values({ ticketId: t.id, userId: a.id, sprintId: t.sprintId });
    await tx.update(tickets).set({ ...RELEASE_FIELDS, updatedAt: now }).where(eq(tickets.id, t.id));
    await audit(tx, {
      actorId: a.id,
      action: "ticket.offer_reject",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
    });
    return rejectionQuota(tx, a.id, t.sprintId, settings.rejectionsPerSprint);
  });
}

/** Kişinin teklifi, aktif ve son teslim ettiği ticket'ları. Yazma yapmaz. */
export async function getMyTickets(db: DB, actor: Actor | null, now: Date = new Date()): Promise<MyTicketsView> {
  const a = requireActor(actor);
  const sprint = await getActiveSprint(db);
  const settings = await getSettings(db);
  const rejections = await rejectionQuota(db, a.id, sprint?.id ?? null, settings.rejectionsPerSprint);

  const [offered] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.status, "offered"), eq(tickets.assigneeId, a.id)))
    .limit(1);
  const activeRows = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.assigneeId, a.id), inArray(tickets.status, [...IN_PROGRESS_STATUSES])))
    .orderBy(asc(tickets.dueAt), asc(tickets.title));
  const recentRows = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.assigneeId, a.id), inArray(tickets.status, ["submitted", "evaluated"])))
    .orderBy(desc(tickets.updatedAt))
    .limit(20);

  const names = await areaNames(db, [
    ...(offered ? [offered.areaId] : []),
    ...activeRows.map((t) => t.areaId),
    ...recentRows.map((t) => t.areaId),
  ]);
  const verdictRows = recentRows.length
    ? await db
        .select({ ticketId: evaluations.ticketId, verdict: evaluations.verdict })
        .from(evaluations)
        .where(
          inArray(
            evaluations.ticketId,
            recentRows.map((t) => t.id),
          ),
        )
        .orderBy(asc(evaluations.createdAt))
    : [];
  const verdicts = new Map<string, Verdict[]>();
  for (const v of verdictRows) verdicts.set(v.ticketId, [...(verdicts.get(v.ticketId) ?? []), v.verdict]);

  const offerValid = offered?.offeredAt && !isOfferExpired(offered.offeredAt, now) ? offered : null;
  return {
    sprint: sprint ? { id: sprint.id, name: sprint.name } : null,
    rejections,
    offer: offerValid ? toOfferView(offerValid, names.get(offerValid.areaId) ?? "") : null,
    active: activeRows.map((t) => toTicketCard(t, names.get(t.areaId) ?? "")),
    recent: recentRows.map((t) => ({ ...toTicketCard(t, names.get(t.areaId) ?? ""), verdicts: verdicts.get(t.id) ?? [] })),
  };
}

