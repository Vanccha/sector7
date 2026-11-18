/**
 * Aşama 2 servislerinin ortak yardımcıları — SÖZLEŞME (teknik lider yazar; alt ajanlar kullanır, değiştirmez).
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { areas, sprints } from "@/db/schema";
import { canManageArea, requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { forbidden, invalidState, notFound } from "@/lib/contracts/errors";
import type { SprintRow } from "@/lib/contracts/plan";

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function getAreaOrThrow(db: DbOrTx, areaId: string) {
  const [a] = await db.select().from(areas).where(eq(areas.id, areaId)).limit(1);
  if (!a) throw notFound("Alan bulunamadı.");
  return a;
}

export async function getSprintOrThrow(db: DbOrTx, sprintId: string) {
  const [s] = await db.select().from(sprints).where(eq(sprints.id, sprintId)).limit(1);
  if (!s) throw notFound("Sprint bulunamadı.");
  return s;
}

export function toSprintRow(s: typeof sprints.$inferSelect): SprintRow {
  return { id: s.id, number: s.number, name: s.name, startDate: s.startDate, lengthDays: s.lengthDays, status: s.status };
}

/** Planlama yapılabilen sprintler: aktif ve planlanmış (eskiden yeniye). */
export async function listPlanningSprints(db: DbOrTx): Promise<SprintRow[]> {
  const rows = await db
    .select()
    .from(sprints)
    .where(inArray(sprints.status, ["active", "planned"]))
    .orderBy(asc(sprints.number));
  return rows.map(toSprintRow);
}

/** sprintId verilmezse: aktif sprint, yoksa ilk planlanmış, yoksa en son sprint. */
export async function resolveSprint(db: DbOrTx, sprintId?: string | null) {
  if (sprintId) return getSprintOrThrow(db, sprintId);
  const [active] = await db.select().from(sprints).where(eq(sprints.status, "active")).limit(1);
  if (active) return active;
  const [planned] = await db
    .select()
    .from(sprints)
    .where(eq(sprints.status, "planned"))
    .orderBy(asc(sprints.number))
    .limit(1);
  if (planned) return planned;
  const [last] = await db.select().from(sprints).orderBy(desc(sprints.number)).limit(1);
  if (!last) throw notFound("Henüz sprint yok. Ana yönetici bir sprint açmalı.");
  return last;
}

/** Alanı görüntüleyebilir mi: alan yöneticisi ya da ana yönetici. */
export async function requireAreaViewer(db: DbOrTx, actor: Actor | null, areaId: string) {
  const a = requireActor(actor);
  const area = await getAreaOrThrow(db, areaId);
  if (!canManageArea(a, areaId)) throw forbidden("Bu alanın planını görme yetkin yok.");
  return { actor: a, area };
}

/**
 * Alanın planını düzenleyebilir mi: alan yöneticisi ya da ana yönetici, alan arşivli değil.
 * Not: arşivli alanın yöneticisi loadActor'da zaten rol almaz; ana yönetici de arşivli alanı düzenleyemez.
 */
export async function requireAreaEditor(db: DbOrTx, actor: Actor | null, areaId: string) {
  const r = await requireAreaViewer(db, actor, areaId);
  if (r.area.archivedAt) throw invalidState("Arşivlenmiş alan düzenlenemez.");
  return r;
}

/** Sprint kapanmadıysa planı değiştirilebilir. */
export function assertSprintOpen(s: { status: string }) {
  if (s.status === "closed" || s.status === "closing") throw invalidState("Kapanmış sprintin planı değiştirilemez.");
}

/** Aktörün yönetebildiği alanlar (ana yönetici: tüm aktif alanlar). Gezinme için. */
export async function listManageableAreas(db: DbOrTx, actor: Actor): Promise<{ id: string; name: string }[]> {
  if (!actor.isMainAdmin && actor.managedAreaIds.length === 0) return [];
  return db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(
      actor.isMainAdmin
        ? isNull(areas.archivedAt)
        : and(isNull(areas.archivedAt), inArray(areas.id, actor.managedAreaIds)),
    )
    .orderBy(asc(areas.name));
}
