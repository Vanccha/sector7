/** Duyuru yetkisi yönetimi (yalnız ana yönetici). */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { notFound } from "@/lib/contracts/errors";

export const setCanAnnounceSchema = z.object({ userId: z.uuid(), value: z.boolean() });

export type AnnounceAccessRow = {
  id: string;
  name: string;
  username: string;
  isMainAdmin: boolean;
  canAnnounce: boolean;
};

export async function listAnnounceAccess(db: DB, actor: Actor | null): Promise<AnnounceAccessRow[]> {
  requireMainAdmin(actor);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      isMainAdmin: user.isMainAdmin,
      canAnnounce: user.canAnnounce,
    })
    .from(user)
    .where(eq(user.active, true))
    .orderBy(asc(user.name), asc(user.id));
  return rows.map((r) => ({ ...r, username: r.username ?? "" }));
}

export async function setCanAnnounce(
  db: DB,
  actor: Actor | null,
  raw: { userId: string; value: boolean },
  now: Date = new Date(),
): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = setCanAnnounceSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [u] = await tx
      .select({ id: user.id, canAnnounce: user.canAnnounce })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);
    if (!u) throw notFound("Kullanıcı bulunamadı.");
    if (u.canAnnounce === input.value) return;
    await tx.update(user).set({ canAnnounce: input.value, updatedAt: now }).where(eq(user.id, u.id));
    await audit(tx, {
      actorId: a.id,
      action: input.value ? "user.grant_announce" : "user.revoke_announce",
      entityType: "user",
      entityId: u.id,
      subjectUserId: u.id,
    });
  });
}
