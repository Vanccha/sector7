/** GitHub senkron yönetimi (Aşama 7.5): alan ↔ depo eşlemesi ve yeniden deneme. */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { areas, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAreaManager, requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { conflict, notFound } from "@/lib/contracts/errors";
import { setAreaRepoSchema } from "@/lib/contracts/github";
import { getAreaOrThrow } from "../plan-common";

/**
 * Alanın deposunu değiştirir (boş = senkron dışı). Aynı depo iki alana atanamaz.
 * Depo değişince ticket'ların eski issue/dal bağları sıfırlanır (eski depodaki issue numarası yeni depoda
 * başka bir issue'yu gösterebilir); draft dışı tüm ticket'lar kuyruğa alınır ve yeni depoda yeniden açılır.
 */
export async function setAreaRepo(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = setAreaRepoSchema.parse(raw);
  await db.transaction(async (tx) => {
    // Eşzamanlı atamalar benzersizlik kontrolünü atlatmasın.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('github-area-repo'))`);
    const area = await getAreaOrThrow(tx, input.areaId);
    if (area.githubRepo === input.repo) return;
    if (input.repo) {
      const dup = await tx.execute<{ id: string }>(
        sql`select id from areas where lower(github_repo) = lower(${input.repo}) and id <> ${area.id} limit 1`,
      );
      if (dup.rows.length > 0) throw conflict("Bu depo başka bir alana atanmış.", { repo: "Bu depo başka bir alana atanmış." });
    }
    await tx.update(areas).set({ githubRepo: input.repo, updatedAt: new Date() }).where(eq(areas.id, area.id));
    await tx
      .update(tickets)
      .set({ githubIssueNumber: null, githubIssueUrl: null, githubBranch: null })
      .where(eq(tickets.areaId, area.id));
    await tx.execute(
      sql`select github_outbox_enqueue(id) from tickets where area_id = ${area.id} and status <> 'draft'`,
    );
    await audit(tx, {
      actorId: a.id,
      action: "github.area_repo",
      entityType: "area",
      entityId: area.id,
      areaId: area.id,
      data: { from: area.githubRepo, to: input.repo },
    });
  });
}

const retrySchema = z.object({ ticketId: z.string().uuid() });

/** Ticket'ı senkron kuyruğuna yeniden alır (deneme sayacı sıfırlanır). Alan yöneticisi ya da ana yönetici. */
export async function retryGithubSync(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const input = retrySchema.parse(raw);
  await db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: tickets.id, areaId: tickets.areaId })
      .from(tickets)
      .where(eq(tickets.id, input.ticketId))
      .limit(1);
    if (!t) throw notFound("Ticket bulunamadı.");
    const a = requireAreaManager(actor, t.areaId);
    await tx.execute(sql`select github_outbox_enqueue(${t.id}::uuid)`);
    await audit(tx, {
      actorId: a.id,
      action: "github.sync_retry",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
    });
  });
}
