import type { DbOrTx } from "@/db";
import { auditLog } from "@/db/schema";
import type { AuditEntry } from "@/lib/contracts/audit";

/** Denetim kaydına yazar. Yazma işlemleriyle aynı transaction içinde çağrılmalıdır. */
export async function audit(db: DbOrTx, e: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    areaId: e.areaId ?? null,
    ticketId: e.ticketId ?? null,
    subjectUserId: e.subjectUserId ?? null,
    data: e.data ?? {},
  });
}
