/** Aşama 5 (ana yönetici paneli) test yardımcıları. */
import { db } from "./db";
import type { Actor } from "../../src/lib/contracts/actor";
import { expectCode } from "./errors";
import { H, T0, type Cycle } from "./cycle";
import { auditLog, evaluations, submissions, ticketRequests } from "../../src/db/schema";

/** Ana yönetici dışındakiler reddedilir: oturumsuz UNAUTHENTICATED, alan yöneticisi ve üye FORBIDDEN. */
export async function expectMainAdminOnly(c: Cycle, call: (actor: Actor | null) => Promise<unknown>) {
  await expectCode(() => call(null), "UNAUTHENTICATED");
  await expectCode(() => call(c.mgrA), "FORBIDDEN");
  await expectCode(() => call(c.member), "FORBIDDEN");
}

export async function insertAudit(o: Partial<typeof auditLog.$inferInsert> & { action: string }) {
  const [r] = await db
    .insert(auditLog)
    .values({ entityType: "test", ...o })
    .returning();
  return r!;
}

/** Bekleyen (varsayılan) talep satırı; respondBy varsayılan T0 + 24 saat. */
export async function insertRequest(
  o: { ticketId: string; requesterId: string } & Partial<typeof ticketRequests.$inferInsert>,
) {
  const [r] = await db
    .insert(ticketRequests)
    .values({ kind: "extension", reason: "Neden", respondBy: new Date(T0.getTime() + 24 * H), ...o })
    .returning();
  return r!;
}

export async function insertEvaluation(o: {
  ticketId: string;
  evaluatorId: string;
  verdict: "good" | "bad";
  createdAt?: Date;
  comment?: string;
}) {
  const [r] = await db.insert(evaluations).values(o).returning();
  return r!;
}

export async function insertSubmission(o: { ticketId: string; userId: string }) {
  const [r] = await db.insert(submissions).values({ description: "Teslim", ...o }).returning();
  return r!;
}
