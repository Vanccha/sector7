/** Sprint yönetimi (yalnız ana yönetici). Next.js'e bağımlı değildir. */
import { desc, eq, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { sprints } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { invalidState } from "@/lib/contracts/errors";
import { createSprintSchema, sprintIdSchema, updateSprintSchema, type SprintRow } from "@/lib/contracts/plan";
import { getSettings } from "@/lib/settings";
import { getSprintOrThrow, toSprintRow } from "./plan-common";

const ONE_ACTIVE_MSG = "Aynı anda tek aktif sprint olabilir; önce aktif sprint kapanmalı.";

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export async function listSprints(db: DbOrTx, actor: Actor | null): Promise<SprintRow[]> {
  requireMainAdmin(actor);
  const rows = await db.select().from(sprints).orderBy(desc(sprints.number));
  return rows.map(toSprintRow);
}

export async function createSprint(db: DB, actor: Actor | null, raw: unknown): Promise<{ id: string }> {
  const a = requireMainAdmin(actor);
  const input = createSprintSchema.parse(raw);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sprints'))`);
    const [last] = await tx.select({ n: sprints.number }).from(sprints).orderBy(desc(sprints.number)).limit(1);
    const number = (last?.n ?? 0) + 1;
    const lengthDays = input.lengthDays ?? (await getSettings(tx)).sprintLengthDays;
    const name = input.name ?? `Sprint ${number}`;
    const [row] = await tx
      .insert(sprints)
      .values({ number, name, startDate: input.startDate, lengthDays, status: "planned" })
      .returning({ id: sprints.id });
    if (!row) throw new Error("Sprint kaydedilemedi.");
    await audit(tx, {
      actorId: a.id,
      action: "sprint.create",
      entityType: "sprint",
      entityId: row.id,
      data: { number, name, startDate: input.startDate, lengthDays },
    });
    return row;
  });
}

export async function updateSprint(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = updateSprintSchema.parse(raw);
  await db.transaction(async (tx) => {
    const s = await getSprintOrThrow(tx, input.sprintId);
    if (s.status === "closed" || s.status === "closing") throw invalidState("Kapanmış sprint düzenlenemez.");
    await tx
      .update(sprints)
      .set({ name: input.name, startDate: input.startDate, lengthDays: input.lengthDays })
      .where(eq(sprints.id, s.id));
    await audit(tx, {
      actorId: a.id,
      action: "sprint.update",
      entityType: "sprint",
      entityId: s.id,
      data: {
        from: { name: s.name, startDate: s.startDate, lengthDays: s.lengthDays },
        to: { name: input.name, startDate: input.startDate, lengthDays: input.lengthDays },
      },
    });
  });
}

export async function startSprint(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = sprintIdSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const s = await getSprintOrThrow(tx, input.sprintId);
      if (s.status !== "planned") throw invalidState("Yalnız planlanmış sprint başlatılabilir.");
      const [active] = await tx.select({ id: sprints.id }).from(sprints).where(eq(sprints.status, "active")).limit(1);
      if (active) throw invalidState(ONE_ACTIVE_MSG);
      await tx.update(sprints).set({ status: "active" }).where(eq(sprints.id, s.id));
      await audit(tx, {
        actorId: a.id,
        action: "sprint.start",
        entityType: "sprint",
        entityId: s.id,
        data: { number: s.number },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw invalidState(ONE_ACTIVE_MSG);
    throw e;
  }
}
