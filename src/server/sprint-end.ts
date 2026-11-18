/** Sprint kapanışı ve sprint sonu kararları. Next.js'e bağımlı değildir. */
import { and, asc, count, eq, inArray, ne, notInArray, or } from "drizzle-orm";
import type { DB, DbOrTx, Tx } from "@/db";
import { sprintEndDecisions, sprints, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageArea, requireActor, requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { AppError, conflict, forbidden, invalidState } from "@/lib/contracts/errors";
import { sprintIdSchema } from "@/lib/contracts/plan";
import {
  findSprintEndOption,
  optionsFor,
  SPRINT_END_OPTIONS,
  type SprintEndDecisionKey,
} from "@/lib/contracts/sprint-end";
import {
  isSprintDone,
  SPRINT_DONE_STATUSES,
  sprintEndDecisionSchema,
  type SprintEndItem,
  type SprintEndView,
} from "@/lib/contracts/tickets";
import { notify } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import type { Settings } from "@/lib/contracts/settings";
import { addHours } from "@/lib/ticket-time";
import { getSprintOrThrow, toSprintRow } from "./plan-common";
import {
  areaNames,
  areaRecipients,
  cancelPendingRequest,
  lockTicket,
  loadUsers,
  mainAdminIds,
  postTicketMessage,
  RELEASE_FIELDS,
  ticketLink,
  toTicketCard,
  type TicketRow,
} from "./ticket-common";

type SprintDbRow = typeof sprints.$inferSelect;

export type HandlerContext = {
  now: Date;
  next: SprintDbRow | null;
  settings: Settings;
  actorId: string;
};

type Handler = (tx: Tx, ticket: TicketRow, ctx: HandlerContext) => Promise<void>;

function needNext(ctx: HandlerContext): SprintDbRow {
  if (!ctx.next) throw invalidState("Önce sonraki sprinti planla (Yönetim → Sprintler).");
  return ctx.next;
}

/** Yeni seçenek: sözleşmedeki SPRINT_END_OPTIONS'a ekle, uygulayıcısını buraya yaz. */
const HANDLERS: Record<SprintEndDecisionKey, Handler> = {
  async move_next(tx, t, ctx) {
    const next = needNext(ctx);
    await tx.update(tickets).set({ sprintId: next.id, updatedAt: ctx.now }).where(eq(tickets.id, t.id));
  },
  async keep_assignee(tx, t, ctx) {
    const next = needNext(ctx);
    await tx
      .update(tickets)
      .set({
        sprintId: next.id,
        dueAt: addHours(ctx.now, ctx.settings.ticketHours),
        pausedAt: t.pausedAt ? ctx.now : null,
        warnedAt: null,
        expiredNotifiedAt: null,
        updatedAt: ctx.now,
      })
      .where(eq(tickets.id, t.id));
  },
  async return_pool(tx, t, ctx) {
    const next = needNext(ctx);
    await cancelPendingRequest(tx, t.id, ctx.now);
    await tx
      .update(tickets)
      .set({ ...RELEASE_FIELDS, sprintId: next.id, updatedAt: ctx.now })
      .where(eq(tickets.id, t.id));
    await postTicketMessage(tx, t, { authorId: null, body: "Sprint sonu kararıyla ticket havuza geri konuldu." });
  },
  async cancel(tx, t, ctx) {
    await cancelPendingRequest(tx, t.id, ctx.now);
    await tx
      .update(tickets)
      .set({ status: "cancelled", pausedAt: null, updatedAt: ctx.now })
      .where(eq(tickets.id, t.id));
    await postTicketMessage(tx, t, { authorId: null, body: "Sprint sonu kararıyla ticket iptal edildi." });
  },
};

/** Kişiyi etkileyen kararlar ve bildirim metni. */
const PERSON_NOTICE: Partial<Record<string, string>> = {
  keep_assignee: "sende kaldı, süresi sonraki sprintle yeniden başladı",
  return_pool: "senden alındı ve havuza geri konuldu",
  cancel: "iptal edildi",
};

/** Sonraki sprint: aktif sprint (bu değilse), yoksa en küçük numaralı planlanmış; yoksa null. */
async function nextSprintFor(tx: DbOrTx, sprint: { id: string }): Promise<SprintDbRow | null> {
  const [active] = await tx
    .select()
    .from(sprints)
    .where(and(eq(sprints.status, "active"), ne(sprints.id, sprint.id)))
    .limit(1);
  if (active) return active;
  const [planned] = await tx
    .select()
    .from(sprints)
    .where(eq(sprints.status, "planned"))
    .orderBy(asc(sprints.number))
    .limit(1);
  return planned ?? null;
}

const unfinishedInSprint = (sprintId: string) =>
  and(eq(tickets.sprintId, sprintId), notInArray(tickets.status, [...SPRINT_DONE_STATUSES]));

export async function beginSprintClose(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = sprintIdSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(sprints).where(eq(sprints.id, input.sprintId)).for("update").limit(1);
    if (!s) throw new AppError("NOT_FOUND", "Sprint bulunamadı.");
    if (s.status !== "active") throw invalidState("Yalnız aktif sprint kapanışa alınabilir.");
    await tx.update(sprints).set({ status: "closing" }).where(eq(sprints.id, s.id));

    const offered = await tx
      .update(tickets)
      .set({ ...RELEASE_FIELDS, updatedAt: now })
      .where(and(eq(tickets.sprintId, s.id), eq(tickets.status, "offered")))
      .returning({ id: tickets.id, areaId: tickets.areaId });
    for (const o of offered) {
      await audit(tx, {
        actorId: a.id,
        action: "ticket.offer_expired",
        entityType: "ticket",
        entityId: o.id,
        areaId: o.areaId,
        ticketId: o.id,
        data: { reason: "sprint_close" },
      });
    }

    const unfinished = await tx
      .selectDistinct({ areaId: tickets.areaId })
      .from(tickets)
      .where(unfinishedInSprint(s.id));
    const recipients = new Set<string>(await mainAdminIds(tx));
    for (const u of unfinished) for (const r of await areaRecipients(tx, u.areaId)) recipients.add(r);
    await notify(tx, {
      userIds: [...recipients],
      type: "sprint_closing",
      title: "Sprint kapanıyor",
      body: `${s.name} kapanış aşamasında; bitmemiş ticket'lar için karar bekleniyor.`,
      link: `/sprint/${s.id}/kapanis`,
    });
    await audit(tx, {
      actorId: a.id,
      action: "sprint.close_begin",
      entityType: "sprint",
      entityId: s.id,
      data: { number: s.number, offersReleased: offered.length, unfinishedAreas: unfinished.length },
    });
  });
}

export async function getSprintEndView(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<SprintEndView> {
  void now; // imza tutarlılığı için; görünüm zamana bağlı değil
  const a = requireActor(actor);
  if (!a.isMainAdmin && a.managedAreaIds.length === 0) throw forbidden("Bu sayfa yalnız yöneticilere açık.");
  const input = sprintIdSchema.parse(raw);
  const s = await getSprintOrThrow(db, input.sprintId);
  if (s.status !== "closing" && s.status !== "closed") throw invalidState("Bu sprint kapanış aşamasında değil.");

  const nextSprint = await nextSprintFor(db, s);
  const decisions = await db.select().from(sprintEndDecisions).where(eq(sprintEndDecisions.sprintId, s.id));
  const decisionByTicket = new Map(decisions.map((d) => [d.ticketId, d]));

  const decidedIds = decisions.map((d) => d.ticketId);
  const rows = await db
    .select()
    .from(tickets)
    .where(or(unfinishedInSprint(s.id), decidedIds.length > 0 ? inArray(tickets.id, decidedIds) : undefined));

  const undecidedTotal = rows.filter((t) => t.sprintId === s.id && !isSprintDone(t.status)).length;
  const visible = rows.filter((t) => canManageArea(a, t.areaId));

  const users = await loadUsers(db, [...visible.map((t) => t.assigneeId), ...decisions.map((d) => d.decidedById)]);
  const names = await areaNames(db, visible.map((t) => t.areaId));

  const items: SprintEndItem[] = visible
    .map((t) => {
      const d = decisionByTicket.get(t.id) ?? null;
      const undecided = !d && t.sprintId === s.id && !isSprintDone(t.status);
      const allowed = undecided
        ? optionsFor(t.status)
            .filter((o) => nextSprint || !o.needsNextSprint)
            .map((o) => o.key)
        : [];
      const decidedBy = d ? users.get(d.decidedById) : undefined;
      return {
        ticket: {
          ...toTicketCard(t, names.get(t.areaId) ?? ""),
          assignee: t.assigneeId ? (users.get(t.assigneeId) ?? null) : null,
        },
        allowedOptions: allowed,
        canDecide: s.status === "closing" && undecided,
        decision:
          d && decidedBy
            ? {
                key: d.decision,
                label: findSprintEndOption(d.decision)?.label ?? d.decision,
                note: d.note,
                decidedBy,
                createdAt: d.createdAt.toISOString(),
              }
            : null,
      };
    })
    .sort((x, y) => Number(!!x.decision) - Number(!!y.decision) || x.ticket.title.localeCompare(y.ticket.title, "tr"));

  return {
    sprint: toSprintRow(s),
    nextSprint: nextSprint ? toSprintRow(nextSprint) : null,
    options: [...SPRINT_END_OPTIONS],
    items,
    undecidedTotal,
    canClose: a.isMainAdmin && s.status === "closing" && undecidedTotal === 0,
  };
}

export async function decideSprintEnd(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const a = requireActor(actor);
  const input = sprintEndDecisionSchema.parse(raw);
  await db.transaction(async (tx) => {
    const s = await getSprintOrThrow(tx, input.sprintId);
    if (s.status !== "closing") throw invalidState("Bu sprint kapanış aşamasında değil.");
    const t = await lockTicket(tx, input.ticketId);
    if (t.sprintId !== s.id || isSprintDone(t.status)) throw invalidState("Bu ticket için karar gerekmiyor.");
    if (!canManageArea(a, t.areaId)) throw forbidden("Bu ticket için karar verme yetkin yok.");

    const option = findSprintEndOption(input.decision);
    const handler = option ? (HANDLERS as Record<string, Handler | undefined>)[option.key] : undefined;
    if (!option || !handler || !(option.appliesTo as readonly string[]).includes(t.status)) {
      throw new AppError("VALIDATION", "Bu ticket için bu seçenek uygulanamaz.");
    }
    const next = await nextSprintFor(tx, s);
    if (option.needsNextSprint && !next) throw invalidState("Önce sonraki sprinti planla (Yönetim → Sprintler).");

    const [dec] = await tx
      .insert(sprintEndDecisions)
      .values({ sprintId: s.id, ticketId: t.id, decision: option.key, note: input.note || null, decidedById: a.id, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: sprintEndDecisions.id });
    if (!dec) throw conflict("Bu ticket için zaten karar verildi.");

    await handler(tx, t, { now, next, settings: await getSettings(tx), actorId: a.id });

    const notice = PERSON_NOTICE[option.key];
    if (t.assigneeId && notice) {
      await notify(tx, {
        userIds: [t.assigneeId],
        type: "ticket_assigned",
        title: "Ticket'ın için sprint sonu kararı",
        body: `"${t.title}" ${notice}.`,
        link: ticketLink(t.id),
      });
    }
    await audit(tx, {
      actorId: a.id,
      action: "sprint.end_decision",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
      subjectUserId: t.assigneeId,
      data: { decision: option.key, previousStatus: t.status, nextSprintId: next?.id ?? null },
    });
  });
}

export async function closeSprint(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = sprintIdSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(sprints).where(eq(sprints.id, input.sprintId)).for("update").limit(1);
    if (!s) throw new AppError("NOT_FOUND", "Sprint bulunamadı.");
    if (s.status !== "closing") throw invalidState("Bu sprint kapanış aşamasında değil.");
    const [c] = await tx.select({ n: count() }).from(tickets).where(unfinishedInSprint(s.id));
    const pending = Number(c?.n ?? 0);
    if (pending > 0) throw invalidState(`${pending} ticket hâlâ karar bekliyor.`);
    await tx.update(sprints).set({ status: "closed", closedAt: now }).where(eq(sprints.id, s.id));
    await audit(tx, {
      actorId: a.id,
      action: "sprint.close",
      entityType: "sprint",
      entityId: s.id,
      data: { number: s.number },
    });
  });
}
