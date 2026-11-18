/** Ticket'lar: basamaklardan oluşturma, düzenleme, iptal, yayınlama, listeleme. */
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { roadmaps, roadmapSteps, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageArea } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { invalidState, notFound } from "@/lib/contracts/errors";
import {
  createTicketSchema,
  isInPool,
  isPrereqDone,
  isTicketEditable,
  publishTicketsSchema,
  roadmapIdSchema,
  ticketIdSchema,
  ticketPositionSchema,
  updateTicketSchema,
  type AreaTicketsView,
  type StepRow,
  type TicketRef,
  type TicketRow,
} from "@/lib/contracts/plan";
import { insertDependencyTx, loadDependents, loadPrerequisites, loadStepTickets } from "./dependencies";
import { assertSprintOpen, getSprintOrThrow, requireAreaEditor, requireAreaViewer, resolveSprint } from "./plan-common";

/** Basamaklar; ticketCount iptal olmayan ticket'ları sayar (iptal edilen basamak yeniden oluşturulabilir). */
async function stepsWithCounts(db: DbOrTx, roadmapId: string): Promise<StepRow[]> {
  const steps = await db
    .select()
    .from(roadmapSteps)
    .where(eq(roadmapSteps.roadmapId, roadmapId))
    .orderBy(asc(roadmapSteps.position));
  if (steps.length === 0) return [];
  const counts = await db
    .select({ stepId: tickets.roadmapStepId, n: count() })
    .from(tickets)
    .where(
      and(
        inArray(
          tickets.roadmapStepId,
          steps.map((s) => s.id),
        ),
        ne(tickets.status, "cancelled"),
      ),
    )
    .groupBy(tickets.roadmapStepId);
  const byStep = new Map(counts.map((c) => [c.stepId, Number(c.n)]));
  const stepTickets = await loadStepTickets(
    db,
    steps.map((s) => s.id),
  );
  return steps.map((s) => ({
    id: s.id,
    position: s.position,
    title: s.title,
    description: s.description,
    goalId: s.goalId,
    ticketCount: byStep.get(s.id) ?? 0,
    afterPrevious: s.afterPrevious,
    ticket: stepTickets.get(s.id) ?? null,
  }));
}

export async function listAreaTickets(
  db: DB,
  actor: Actor | null,
  raw: { areaId: string; sprintId?: string | null },
): Promise<AreaTicketsView> {
  const { actor: a, area } = await requireAreaViewer(db, actor, raw.areaId);
  const sprint = await resolveSprint(db, raw.sprintId);
  const rows = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.areaId, area.id), eq(tickets.sprintId, sprint.id)))
    .orderBy(asc(tickets.createdAt), asc(tickets.title));
  const prereqs = await loadPrerequisites(
    db,
    rows.map((r) => r.id),
  );
  const dependents = await loadDependents(
    db,
    rows.map((r) => r.id),
  );
  const external = new Map<string, TicketRef>();
  const out: TicketRow[] = rows.map((r) => {
    const prerequisites = prereqs.get(r.id) ?? [];
    const blockedBy = prerequisites.filter((p) => !isPrereqDone(p.status));
    for (const p of prerequisites) if (p.areaId !== area.id) external.set(p.id, p);
    return {
      id: r.id,
      areaId: r.areaId,
      sprintId: r.sprintId,
      roadmapStepId: r.roadmapStepId,
      title: r.title,
      description: r.description,
      status: r.status,
      posX: r.posX,
      posY: r.posY,
      prerequisites,
      blockedBy,
      takeable: isInPool(r.status) && blockedBy.length === 0,
      dependents: dependents.get(r.id) ?? [],
    };
  });
  out.sort((x, y) => Number(x.status === "cancelled") - Number(y.status === "cancelled"));
  const [roadmap] = await db
    .select()
    .from(roadmaps)
    .where(and(eq(roadmaps.areaId, area.id), eq(roadmaps.sprintId, sprint.id)))
    .limit(1);
  return {
    tickets: out,
    externalPrerequisites: [...external.values()],
    steps: roadmap ? await stepsWithCounts(db, roadmap.id) : [],
    roadmapStatus: roadmap?.status ?? null,
    canEdit: canManageArea(a, area.id) && !area.archivedAt && sprint.status !== "closed" && sprint.status !== "closing",
  };
}

async function approvedRoadmapForEdit(tx: DbOrTx, actor: Actor | null, roadmapId: string) {
  const [roadmap] = await tx.select().from(roadmaps).where(eq(roadmaps.id, roadmapId)).limit(1);
  if (!roadmap) throw notFound("Roadmap bulunamadı.");
  const { actor: a } = await requireAreaEditor(tx, actor, roadmap.areaId);
  assertSprintOpen(await getSprintOrThrow(tx, roadmap.sprintId));
  if (roadmap.status !== "approved") throw invalidState("Roadmap onaylanmadan ticket oluşturulamaz.");
  return { roadmap, actor: a };
}

export async function createTicket(
  db: DB,
  actor: Actor | null,
  raw: { roadmapStepId: string; title?: string; description?: string },
): Promise<{ id: string }> {
  const input = createTicketSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [step] = await tx.select().from(roadmapSteps).where(eq(roadmapSteps.id, input.roadmapStepId)).limit(1);
    if (!step) throw notFound("Basamak bulunamadı.");
    const { roadmap, actor: a } = await approvedRoadmapForEdit(tx, actor, step.roadmapId);
    const [row] = await tx
      .insert(tickets)
      .values({
        areaId: roadmap.areaId,
        sprintId: roadmap.sprintId,
        roadmapStepId: step.id,
        title: input.title || step.title,
        description: input.description ?? step.description,
        status: "draft",
        createdById: a.id,
      })
      .returning({ id: tickets.id });
    if (!row) throw new Error("Ticket kaydedilemedi.");
    await audit(tx, {
      actorId: a.id,
      action: "ticket.create",
      entityType: "ticket",
      entityId: row.id,
      areaId: roadmap.areaId,
      ticketId: row.id,
      data: { roadmapStepId: step.id },
    });
    return row;
  });
}

export async function createTicketsFromSteps(
  db: DB,
  actor: Actor | null,
  raw: { roadmapId: string },
): Promise<{ created: number }> {
  const input = roadmapIdSchema.parse(raw);
  return db.transaction(async (tx) => {
    const { roadmap, actor: a } = await approvedRoadmapForEdit(tx, actor, input.roadmapId);
    const steps = await stepsWithCounts(tx, roadmap.id);
    // Sıralı ilişki bağlantıları ve çift yazımı serileştirmek için kilit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ticket_dependencies'))`);
    // Basamak başına iptal edilmemiş ticket (var olan ya da bu çağrıda oluşan).
    const ticketOf = new Map<string, string>();
    for (const s of steps) if (s.ticket) ticketOf.set(s.id, s.ticket.id);
    let created = 0;
    for (const [i, s] of steps.entries()) {
      if (s.ticketCount > 0) continue;
      const [row] = await tx
        .insert(tickets)
        .values({
          areaId: roadmap.areaId,
          sprintId: roadmap.sprintId,
          roadmapStepId: s.id,
          title: s.title,
          description: s.description,
          status: "draft",
          createdById: a.id,
        })
        .returning({ id: tickets.id });
      if (!row) throw new Error("Ticket kaydedilemedi.");
      ticketOf.set(s.id, row.id);
      created++;
      await audit(tx, {
        actorId: a.id,
        action: "ticket.create",
        entityType: "ticket",
        entityId: row.id,
        areaId: roadmap.areaId,
        ticketId: row.id,
        data: { roadmapStepId: s.id, bulk: true },
      });
      const prevId = s.afterPrevious && i > 0 ? ticketOf.get(steps[i - 1]?.id ?? "") : undefined;
      if (prevId) {
        await insertDependencyTx(tx, a.id, { id: row.id, areaId: roadmap.areaId }, prevId, { auto: true });
      }
    }
    return { created };
  });
}

async function lockTicket(tx: DbOrTx, ticketId: string) {
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update").limit(1);
  if (!t) throw notFound("Ticket bulunamadı.");
  return t;
}

export async function updateTicket(
  db: DB,
  actor: Actor | null,
  raw: { ticketId: string; title: string; description?: string },
) {
  const input = updateTicketSchema.parse(raw);
  await db.transaction(async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    const { actor: a } = await requireAreaEditor(tx, actor, t.areaId);
    assertSprintOpen(await getSprintOrThrow(tx, t.sprintId));
    if (!isTicketEditable(t.status)) throw invalidState("Bu ticket artık düzenlenemez.");
    await tx
      .update(tickets)
      .set({ title: input.title, description: input.description, updatedAt: new Date() })
      .where(eq(tickets.id, t.id));
    await audit(tx, {
      actorId: a.id,
      action: "ticket.update",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
      data: { from: { title: t.title, description: t.description }, to: { title: input.title } },
    });
  });
}

export async function cancelTicket(db: DB, actor: Actor | null, raw: { ticketId: string }) {
  const input = ticketIdSchema.parse(raw);
  await db.transaction(async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    const { actor: a } = await requireAreaEditor(tx, actor, t.areaId);
    assertSprintOpen(await getSprintOrThrow(tx, t.sprintId));
    if (!isTicketEditable(t.status)) throw invalidState("Bu ticket artık iptal edilemez.");
    await tx.update(tickets).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tickets.id, t.id));
    await audit(tx, {
      actorId: a.id,
      action: "ticket.cancel",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
      data: { previousStatus: t.status },
    });
  });
}

export async function publishTickets(
  db: DB,
  actor: Actor | null,
  raw: { ticketIds: string[] },
): Promise<{ published: number }> {
  const input = publishTicketsSchema.parse(raw);
  const ids = [...new Set(input.ticketIds)];
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(tickets).where(inArray(tickets.id, ids)).for("update");
    if (rows.length !== ids.length) throw notFound("Ticket'lardan biri bulunamadı.");
    let actorId = "";
    for (const areaId of new Set(rows.map((r) => r.areaId))) {
      actorId = (await requireAreaEditor(tx, actor, areaId)).actor.id;
    }
    for (const sprintId of new Set(rows.map((r) => r.sprintId))) {
      assertSprintOpen(await getSprintOrThrow(tx, sprintId));
    }
    if (rows.some((r) => r.status !== "draft")) {
      throw invalidState("Yalnız taslak ticket'lar yayınlanabilir; seçimde taslak olmayan var.");
    }
    await tx
      .update(tickets)
      .set({ status: "available", updatedAt: new Date() })
      .where(and(inArray(tickets.id, ids), eq(tickets.status, "draft")));
    for (const r of rows) {
      await audit(tx, {
        actorId,
        action: "ticket.publish",
        entityType: "ticket",
        entityId: r.id,
        areaId: r.areaId,
        ticketId: r.id,
      });
    }
    return { published: rows.length };
  });
}

/** Yalnız görünüm: denetim kaydı yok. */
export async function setTicketPosition(db: DB, actor: Actor | null, raw: { ticketId: string; x: number; y: number }) {
  const input = ticketPositionSchema.parse(raw);
  const [t] = await db.select({ areaId: tickets.areaId }).from(tickets).where(eq(tickets.id, input.ticketId)).limit(1);
  if (!t) throw notFound("Ticket bulunamadı.");
  await requireAreaEditor(db, actor, t.areaId);
  await db.update(tickets).set({ posX: input.x, posY: input.y }).where(eq(tickets.id, input.ticketId));
}
