/** Aşama 3 (ticket döngüsü) test yardımcıları. Zaman `now` parametresiyle sabitlenir. */
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { expect } from "vitest";
import { db, makeActiveSprint, makeActor, makeArea, makeMainAdmin } from "./db";
import { makeManagerActor, makeTicketRow } from "./plan";
import { notificationPrefs, notifications, settings, tickets } from "../../src/db/schema";
import { AppError } from "../../src/lib/contracts/errors";
import type { Actor } from "../../src/lib/contracts/actor";

export const H = 3_600_000;
export const MIN = 60_000;
export const SEC = 1000;
/** Sabit "şimdi". */
export const T0 = new Date("2026-11-18T09:00:00.000Z");
export const at = (ms: number) => new Date(T0.getTime() + ms);

export type Cycle = Awaited<ReturnType<typeof setupCycle>>;

/** Aktif sprint, ana yönetici, iki alan (yöneticileriyle), ana alanı `home` olan bir üye. */
export async function setupCycle() {
  const sprint = await makeActiveSprint();
  const admin = await makeMainAdmin();
  const a = await makeManagerActor();
  const b = await makeManagerActor();
  const home = await makeArea();
  const member = await makeActor({ homeAreaId: home.id, name: "Üye Bir" });
  return { sprint, admin, a, b, mgrA: a.actor, mgrB: b.actor, areaA: a.area, areaB: b.area, home, member };
}

export async function makeMember(homeAreaId: string, name = "Üye") {
  return makeActor({ homeAreaId, name });
}

/** Havuzda (available) ticket. */
export function poolTicket(c: Cycle, areaId: string, over: Partial<typeof tickets.$inferInsert> = {}) {
  return makeTicketRow({ areaId, sprintId: c.sprint.id, createdById: c.admin.id, status: "available", ...over });
}

/** Birine alınmış (taken) ticket; dueAt = now + 72 saat. */
export function takenTicket(
  c: Cycle,
  areaId: string,
  assignee: Actor,
  over: Partial<typeof tickets.$inferInsert> = {},
  now: Date = T0,
) {
  return makeTicketRow({
    areaId,
    sprintId: c.sprint.id,
    createdById: c.admin.id,
    status: "taken",
    assigneeId: assignee.id,
    takenAt: now,
    dueAt: new Date(now.getTime() + 72 * H),
    ...over,
  });
}

export async function setSetting(key: string, value: unknown) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function notifsOf(userId: string, type?: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return type ? rows.filter((r) => r.type === type) : rows;
}

export async function allNotifs(type?: string) {
  const rows = await db.select().from(notifications);
  return type ? rows.filter((r) => r.type === type) : rows;
}

/** Uygulama içini kapatır; `push` verilmezse push açık kalır (notify: satır readAt dolu yazılır). */
export async function muteInApp(userId: string, type: string, push = true) {
  await db.insert(notificationPrefs).values({ userId, type, inApp: false, push });
}

/** Ticket'ı havuza geri koyar (testlerde art arda çekme için). */
export async function resetToPool(ids: string[]) {
  for (const id of ids) {
    await db
      .update(tickets)
      .set({ status: "available", assigneeId: null, offeredAt: null, takenAt: null, dueAt: null, pausedAt: null })
      .where(eq(tickets.id, id));
  }
}

/** Geçersiz girdi: ZodError ya da AppError(VALIDATION) kabul edilir. */
export async function expectValidation(p: Promise<unknown>) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  const ok = err instanceof ZodError || (err instanceof AppError && err.code === "VALIDATION");
  expect(ok, `beklenen: doğrulama hatası, gelen: ${String(err)}`).toBe(true);
}

export async function ticketById(id: string) {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id));
  return t!;
}
