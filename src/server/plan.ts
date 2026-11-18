/** Hedefler, roadmap ve ana yönetici onayı. Next.js'e bağımlı değildir. */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { areas, goals, roadmaps, roadmapSteps, sprints, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageArea, requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { invalidState, notFound } from "@/lib/contracts/errors";
import {
  addStepSchema,
  createGoalSchema,
  goalIdSchema,
  reorderStepsSchema,
  returnRoadmapSchema,
  roadmapIdSchema,
  roadmapRefSchema,
  stepIdSchema,
  updateGoalSchema,
  updateStepSchema,
  type AreaPlan,
  type GoalRow,
  type RoadmapReviewItem,
  type RoadmapStatus,
  type StepRow,
} from "@/lib/contracts/plan";
import {
  assertSprintOpen,
  getSprintOrThrow,
  iso,
  requireAreaEditor,
  requireAreaViewer,
  resolveSprint,
  toSprintRow,
} from "./plan-common";

const toGoalRow = (g: typeof goals.$inferSelect): GoalRow => ({
  id: g.id,
  sprintId: g.sprintId,
  areaId: g.areaId,
  title: g.title,
  requirements: g.requirements,
});

async function loadSteps(db: DbOrTx, roadmapIds: string[]): Promise<Map<string, StepRow[]>> {
  const map = new Map<string, StepRow[]>();
  if (roadmapIds.length === 0) return map;
  const rows = await db
    .select({
      id: roadmapSteps.id,
      roadmapId: roadmapSteps.roadmapId,
      position: roadmapSteps.position,
      title: roadmapSteps.title,
      description: roadmapSteps.description,
      goalId: roadmapSteps.goalId,
      ticketCount: count(tickets.id),
    })
    .from(roadmapSteps)
    .leftJoin(tickets, eq(tickets.roadmapStepId, roadmapSteps.id))
    .where(inArray(roadmapSteps.roadmapId, roadmapIds))
    .groupBy(roadmapSteps.id)
    .orderBy(asc(roadmapSteps.position));
  for (const r of rows) {
    const list = map.get(r.roadmapId) ?? [];
    list.push({
      id: r.id,
      position: r.position,
      title: r.title,
      description: r.description,
      goalId: r.goalId,
      ticketCount: Number(r.ticketCount),
    });
    map.set(r.roadmapId, list);
  }
  return map;
}

export async function getAreaPlan(
  db: DB,
  actor: Actor | null,
  raw: { areaId: string; sprintId?: string },
): Promise<AreaPlan> {
  const { area } = await requireAreaViewer(db, actor, raw.areaId);
  const sprint = await resolveSprint(db, raw.sprintId);
  const goalRows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.areaId, area.id), eq(goals.sprintId, sprint.id)))
    .orderBy(asc(goals.createdAt));
  const [rm] = await db
    .select()
    .from(roadmaps)
    .where(and(eq(roadmaps.areaId, area.id), eq(roadmaps.sprintId, sprint.id)))
    .limit(1);
  const steps = rm ? ((await loadSteps(db, [rm.id])).get(rm.id) ?? []) : [];
  return {
    area: { id: area.id, name: area.name, archived: area.archivedAt !== null },
    sprint: toSprintRow(sprint),
    goals: goalRows.map(toGoalRow),
    roadmap: {
      id: rm?.id ?? null,
      sprintId: sprint.id,
      areaId: area.id,
      status: rm?.status ?? "draft",
      reviewNote: rm?.reviewNote ?? null,
      submittedAt: iso(rm?.submittedAt),
      reviewedAt: iso(rm?.reviewedAt),
      steps,
    },
    canEdit:
      canManageArea(actor, area.id) &&
      area.archivedAt === null &&
      sprint.status !== "closed" &&
      sprint.status !== "closing",
  };
}

/* ------------------------------ Hedefler ------------------------------ */

export async function createGoal(db: DB, actor: Actor | null, raw: unknown): Promise<{ id: string }> {
  const input = createGoalSchema.parse(raw);
  const { actor: a } = await requireAreaEditor(db, actor, input.areaId);
  return db.transaction(async (tx) => {
    assertSprintOpen(await getSprintOrThrow(tx, input.sprintId));
    const [g] = await tx
      .insert(goals)
      .values({
        areaId: input.areaId,
        sprintId: input.sprintId,
        title: input.title,
        requirements: input.requirements,
        createdById: a.id,
      })
      .returning({ id: goals.id });
    if (!g) throw new Error("Hedef kaydedilemedi.");
    await audit(tx, {
      actorId: a.id,
      action: "goal.create",
      entityType: "goal",
      entityId: g.id,
      areaId: input.areaId,
      data: { sprintId: input.sprintId, title: input.title },
    });
    return g;
  });
}

async function loadGoalForEdit(db: DB, actor: Actor | null, goalId: string) {
  const [g] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!g) throw notFound("Hedef bulunamadı.");
  const { actor: a } = await requireAreaEditor(db, actor, g.areaId);
  return { goal: g, actor: a };
}

export async function updateGoal(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = updateGoalSchema.parse(raw);
  const { goal, actor: a } = await loadGoalForEdit(db, actor, input.goalId);
  await db.transaction(async (tx) => {
    assertSprintOpen(await getSprintOrThrow(tx, goal.sprintId));
    await tx
      .update(goals)
      .set({ title: input.title, requirements: input.requirements, updatedAt: new Date() })
      .where(eq(goals.id, goal.id));
    await audit(tx, {
      actorId: a.id,
      action: "goal.update",
      entityType: "goal",
      entityId: goal.id,
      areaId: goal.areaId,
      data: { title: input.title },
    });
  });
}

export async function deleteGoal(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = goalIdSchema.parse(raw);
  const { goal, actor: a } = await loadGoalForEdit(db, actor, input.goalId);
  await db.transaction(async (tx) => {
    assertSprintOpen(await getSprintOrThrow(tx, goal.sprintId));
    await tx.update(roadmapSteps).set({ goalId: null }).where(eq(roadmapSteps.goalId, goal.id));
    await tx.delete(goals).where(eq(goals.id, goal.id));
    await audit(tx, {
      actorId: a.id,
      action: "goal.delete",
      entityType: "goal",
      entityId: goal.id,
      areaId: goal.areaId,
      data: { title: goal.title },
    });
  });
}

/* ------------------------------ Basamaklar ----------------------------- */

type RoadmapRow = typeof roadmaps.$inferSelect;

async function lockRoadmap(tx: DbOrTx, roadmapId: string): Promise<RoadmapRow> {
  const [rm] = await tx.select().from(roadmaps).where(eq(roadmaps.id, roadmapId)).for("update").limit(1);
  if (!rm) throw notFound("Roadmap bulunamadı.");
  return rm;
}

/** Basamak değişikliği sonrası: onaylı roadmap yeniden onaya düşer. */
async function resubmitIfApproved(tx: DbOrTx, rm: RoadmapRow, actorId: string) {
  if (rm.status !== "approved") return;
  const now = new Date();
  await tx
    .update(roadmaps)
    .set({ status: "submitted", submittedAt: now, reviewNote: null, updatedAt: now })
    .where(eq(roadmaps.id, rm.id));
  await audit(tx, {
    actorId,
    action: "roadmap.resubmit",
    entityType: "roadmap",
    entityId: rm.id,
    areaId: rm.areaId,
    data: { sprintId: rm.sprintId },
  });
}

async function assertGoalBelongs(tx: DbOrTx, goalId: string | null, areaId: string, sprintId: string) {
  if (!goalId) return;
  const [g] = await tx
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.areaId, areaId), eq(goals.sprintId, sprintId)))
    .limit(1);
  if (!g) throw invalidState("Seçilen hedef bu alanın bu sprintine ait değil.");
}

export async function addStep(db: DB, actor: Actor | null, raw: unknown): Promise<{ id: string }> {
  const input = addStepSchema.parse(raw);
  const { actor: a } = await requireAreaEditor(db, actor, input.areaId);
  return db.transaction(async (tx) => {
    assertSprintOpen(await getSprintOrThrow(tx, input.sprintId));
    await assertGoalBelongs(tx, input.goalId, input.areaId, input.sprintId);
    await tx
      .insert(roadmaps)
      .values({ areaId: input.areaId, sprintId: input.sprintId })
      .onConflictDoNothing({ target: [roadmaps.sprintId, roadmaps.areaId] });
    const [found] = await tx
      .select({ id: roadmaps.id })
      .from(roadmaps)
      .where(and(eq(roadmaps.areaId, input.areaId), eq(roadmaps.sprintId, input.sprintId)))
      .limit(1);
    if (!found) throw new Error("Roadmap oluşturulamadı.");
    const rm = await lockRoadmap(tx, found.id);
    const [max] = await tx
      .select({ m: sql<number>`coalesce(max(${roadmapSteps.position}), 0)` })
      .from(roadmapSteps)
      .where(eq(roadmapSteps.roadmapId, rm.id));
    const [s] = await tx
      .insert(roadmapSteps)
      .values({
        roadmapId: rm.id,
        goalId: input.goalId,
        position: Number(max?.m ?? 0) + 1,
        title: input.title,
        description: input.description,
      })
      .returning({ id: roadmapSteps.id });
    if (!s) throw new Error("Basamak kaydedilemedi.");
    await audit(tx, {
      actorId: a.id,
      action: "roadmap.step_add",
      entityType: "roadmap_step",
      entityId: s.id,
      areaId: rm.areaId,
      data: { roadmapId: rm.id, title: input.title },
    });
    await resubmitIfApproved(tx, rm, a.id);
    return s;
  });
}

async function loadStepContext(db: DB, actor: Actor | null, stepId: string) {
  const [row] = await db
    .select({ step: roadmapSteps, areaId: roadmaps.areaId, sprintId: roadmaps.sprintId, roadmapId: roadmaps.id })
    .from(roadmapSteps)
    .innerJoin(roadmaps, eq(roadmaps.id, roadmapSteps.roadmapId))
    .where(eq(roadmapSteps.id, stepId))
    .limit(1);
  if (!row) throw notFound("Basamak bulunamadı.");
  const { actor: a } = await requireAreaEditor(db, actor, row.areaId);
  return { ...row, actor: a };
}

export async function updateStep(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = updateStepSchema.parse(raw);
  const ctx = await loadStepContext(db, actor, input.stepId);
  await db.transaction(async (tx) => {
    assertSprintOpen(await getSprintOrThrow(tx, ctx.sprintId));
    const rm = await lockRoadmap(tx, ctx.roadmapId);
    await assertGoalBelongs(tx, input.goalId, ctx.areaId, ctx.sprintId);
    await tx
      .update(roadmapSteps)
      .set({ title: input.title, description: input.description, goalId: input.goalId })
      .where(eq(roadmapSteps.id, input.stepId));
    await audit(tx, {
      actorId: ctx.actor.id,
      action: "roadmap.step_update",
      entityType: "roadmap_step",
      entityId: input.stepId,
      areaId: ctx.areaId,
      data: { roadmapId: rm.id, title: input.title },
    });
    await resubmitIfApproved(tx, rm, ctx.actor.id);
  });
}

export async function deleteStep(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = stepIdSchema.parse(raw);
  const ctx = await loadStepContext(db, actor, input.stepId);
  await db.transaction(async (tx) => {
    assertSprintOpen(await getSprintOrThrow(tx, ctx.sprintId));
    const rm = await lockRoadmap(tx, ctx.roadmapId);
    const [t] = await tx.select({ n: count() }).from(tickets).where(eq(tickets.roadmapStepId, input.stepId));
    if (Number(t?.n ?? 0) > 0) throw invalidState("Bu basamaktan ticket oluşturulmuş; silinemez.");
    await tx.delete(roadmapSteps).where(eq(roadmapSteps.id, input.stepId));
    await audit(tx, {
      actorId: ctx.actor.id,
      action: "roadmap.step_delete",
      entityType: "roadmap_step",
      entityId: input.stepId,
      areaId: ctx.areaId,
      data: { roadmapId: rm.id, title: ctx.step.title },
    });
    await resubmitIfApproved(tx, rm, ctx.actor.id);
  });
}

export async function reorderSteps(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = reorderStepsSchema.parse(raw);
  const [meta] = await db
    .select({ areaId: roadmaps.areaId, sprintId: roadmaps.sprintId })
    .from(roadmaps)
    .where(eq(roadmaps.id, input.roadmapId))
    .limit(1);
  if (!meta) throw notFound("Roadmap bulunamadı.");
  const { actor: a } = await requireAreaEditor(db, actor, meta.areaId);
  await db.transaction(async (tx) => {
    assertSprintOpen(await getSprintOrThrow(tx, meta.sprintId));
    const rm = await lockRoadmap(tx, input.roadmapId);
    const current = await tx
      .select({ id: roadmapSteps.id })
      .from(roadmapSteps)
      .where(eq(roadmapSteps.roadmapId, rm.id));
    const ids = new Set(current.map((s) => s.id));
    const given = new Set(input.stepIds);
    if (given.size !== input.stepIds.length || given.size !== ids.size || ![...given].every((i) => ids.has(i))) {
      throw invalidState("Sıralama güncel basamak listesiyle uyuşmuyor. Sayfayı yenile.");
    }
    for (const [i, id] of input.stepIds.entries()) {
      await tx
        .update(roadmapSteps)
        .set({ position: i + 1 })
        .where(eq(roadmapSteps.id, id));
    }
    await audit(tx, {
      actorId: a.id,
      action: "roadmap.steps_reorder",
      entityType: "roadmap",
      entityId: rm.id,
      areaId: rm.areaId,
      data: { stepIds: input.stepIds },
    });
    await resubmitIfApproved(tx, rm, a.id);
  });
}

/* ------------------------------ Onay akışı ----------------------------- */

export async function submitRoadmap(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = roadmapRefSchema.parse(raw);
  const { actor: a } = await requireAreaEditor(db, actor, input.areaId);
  await db.transaction(async (tx) => {
    assertSprintOpen(await getSprintOrThrow(tx, input.sprintId));
    const [found] = await tx
      .select({ id: roadmaps.id })
      .from(roadmaps)
      .where(and(eq(roadmaps.areaId, input.areaId), eq(roadmaps.sprintId, input.sprintId)))
      .limit(1);
    if (!found) throw invalidState("Onaya göndermek için en az bir basamak ekle.");
    const rm = await lockRoadmap(tx, found.id);
    if (rm.status !== "draft" && rm.status !== "returned") {
      throw invalidState("Bu roadmap şu an onaya gönderilemez.");
    }
    const [n] = await tx.select({ n: count() }).from(roadmapSteps).where(eq(roadmapSteps.roadmapId, rm.id));
    if (Number(n?.n ?? 0) < 1) throw invalidState("Onaya göndermek için en az bir basamak ekle.");
    const now = new Date();
    await tx
      .update(roadmaps)
      .set({ status: "submitted", submittedAt: now, reviewNote: null, updatedAt: now })
      .where(eq(roadmaps.id, rm.id));
    await audit(tx, {
      actorId: a.id,
      action: "roadmap.submit",
      entityType: "roadmap",
      entityId: rm.id,
      areaId: rm.areaId,
      data: { sprintId: rm.sprintId },
    });
  });
}

async function review(
  db: DB,
  actor: Actor | null,
  roadmapId: string,
  to: "approved" | "returned",
  note: string | null,
) {
  const a = requireMainAdmin(actor);
  await db.transaction(async (tx) => {
    const rm = await lockRoadmap(tx, roadmapId);
    if (rm.status !== "submitted") throw invalidState("Yalnız onay bekleyen roadmap sonuçlandırılabilir.");
    const now = new Date();
    await tx
      .update(roadmaps)
      .set({ status: to, reviewedById: a.id, reviewedAt: now, reviewNote: note, updatedAt: now })
      .where(eq(roadmaps.id, rm.id));
    await audit(tx, {
      actorId: a.id,
      action: to === "approved" ? "roadmap.approve" : "roadmap.return",
      entityType: "roadmap",
      entityId: rm.id,
      areaId: rm.areaId,
      data: { sprintId: rm.sprintId, ...(note ? { note } : {}) },
    });
  });
}

export async function approveRoadmap(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = roadmapIdSchema.parse(raw);
  await review(db, actor, input.roadmapId, "approved", null);
}

export async function returnRoadmap(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = returnRoadmapSchema.parse(raw);
  await review(db, actor, input.roadmapId, "returned", input.note);
}

export async function listRoadmapsForReview(
  db: DB,
  actor: Actor | null,
  opts: { status: "submitted" | "all" },
): Promise<RoadmapReviewItem[]> {
  requireMainAdmin(actor);
  const rows = await db
    .select({ rm: roadmaps, areaName: areas.name, sprintName: sprints.name })
    .from(roadmaps)
    .innerJoin(areas, eq(areas.id, roadmaps.areaId))
    .innerJoin(sprints, eq(sprints.id, roadmaps.sprintId))
    .where(
      opts.status === "submitted" ? eq(roadmaps.status, "submitted") : inArray(sprints.status, ["active", "planned"]),
    )
    .orderBy(asc(roadmaps.submittedAt), desc(roadmaps.updatedAt));
  if (rows.length === 0) return [];
  const steps = await loadSteps(
    db,
    rows.map((r) => r.rm.id),
  );
  const goalRows = await db
    .select()
    .from(goals)
    .where(
      and(
        inArray(goals.areaId, [...new Set(rows.map((r) => r.rm.areaId))]),
        inArray(goals.sprintId, [...new Set(rows.map((r) => r.rm.sprintId))]),
      ),
    )
    .orderBy(asc(goals.createdAt));
  const items = rows.map(
    (r): RoadmapReviewItem => ({
      roadmapId: r.rm.id,
      area: { id: r.rm.areaId, name: r.areaName },
      sprint: { id: r.rm.sprintId, name: r.sprintName },
      status: r.rm.status as RoadmapStatus,
      submittedAt: iso(r.rm.submittedAt),
      reviewNote: r.rm.reviewNote,
      goals: goalRows.filter((g) => g.areaId === r.rm.areaId && g.sprintId === r.rm.sprintId).map(toGoalRow),
      steps: steps.get(r.rm.id) ?? [],
    }),
  );
  if (opts.status === "all") {
    // Onay bekleyenler önce (eskiden yeniye), sonra kalanlar.
    const rank = (i: RoadmapReviewItem) => (i.status === "submitted" ? 0 : 1);
    return items.sort((x, y) => rank(x) - rank(y));
  }
  return items;
}
