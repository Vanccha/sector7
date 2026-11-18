/** Aşama 2 (plan) test yardımcıları. */
import { eq } from "drizzle-orm";
import { db, makeArea, makeUser } from "./db";
import { auditLog, roadmaps, roadmapSteps, tickets } from "../../src/db/schema";
import { loadActor } from "../../src/lib/auth/guards";
import type { Actor } from "../../src/lib/contracts/actor";

/** Yeni bir kullanıcıyı yeni alanın yöneticisi yapar; aktörü atama SONRASI yükler. */
export async function makeManagerActor(areaOver: Parameters<typeof makeArea>[0] = {}) {
  const u = await makeUser();
  const area = await makeArea({ managerId: u.id, ...areaOver });
  const actor = (await loadActor(db, u.id)) as Actor;
  return { user: u, area, actor };
}

type TicketInsert = typeof tickets.$inferInsert;

export async function makeTicketRow(
  o: { areaId: string; sprintId: string; createdById: string } & Partial<TicketInsert>,
) {
  const [t] = await db
    .insert(tickets)
    .values({ title: `Ticket ${Math.random().toString(36).slice(2, 8)}`, status: "draft", ...o })
    .returning();
  return t!;
}

/** Roadmap (varsayılan onaylı) + basamaklar, doğrudan veritabanına. */
export async function setupApprovedRoadmap(o: {
  areaId: string;
  sprintId: string;
  stepTitles?: string[];
  status?: "draft" | "submitted" | "approved" | "returned";
}) {
  const [rm] = await db
    .insert(roadmaps)
    .values({ areaId: o.areaId, sprintId: o.sprintId, status: o.status ?? "approved" })
    .returning();
  const titles = o.stepTitles ?? ["Basamak 1", "Basamak 2"];
  const steps = [];
  for (const [i, title] of titles.entries()) {
    const [s] = await db
      .insert(roadmapSteps)
      .values({ roadmapId: rm!.id, position: i + 1, title, description: `${title} açıklaması` })
      .returning();
    steps.push(s!);
  }
  return { roadmap: rm!, steps };
}

export async function auditRows(action: string, entityId?: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.action, action));
  return entityId ? rows.filter((r) => r.entityId === entityId) : rows;
}

export async function getRoadmap(id: string) {
  const [r] = await db.select().from(roadmaps).where(eq(roadmaps.id, id));
  return r!;
}

export async function getTicket(id: string) {
  const [r] = await db.select().from(tickets).where(eq(tickets.id, id));
  return r!;
}
