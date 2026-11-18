/**
 * Aşama 5 — ayarlar (yalnız ana yönetici).
 * Değişiklikler yalnız SONRAKİ işlemlere uygulanır: mevcut ticket'ların dueAt'i, açık taleplerin
 * cevap süresi vb. yeniden hesaplanmaz.
 */
import { desc, eq } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { settings as settingsTable, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { SETTING_META, updateSettingsSchema, type SettingsView } from "@/lib/contracts/admin";
import { DEFAULT_SETTINGS, type SettingKey, type Settings } from "@/lib/contracts/settings";
import { getSettings } from "@/lib/settings";

export async function getSettingsView(db: DbOrTx, actor: Actor | null): Promise<SettingsView> {
  requireMainAdmin(actor);
  const values = await getSettings(db);
  const [last] = await db
    .select({ updatedAt: settingsTable.updatedAt, userId: user.id, name: user.name, username: user.username })
    .from(settingsTable)
    .leftJoin(user, eq(user.id, settingsTable.updatedById))
    .orderBy(desc(settingsTable.updatedAt))
    .limit(1);
  return {
    values,
    defaults: DEFAULT_SETTINGS,
    updatedAt: last ? last.updatedAt.toISOString() : null,
    updatedBy: last?.userId ? { id: last.userId, name: last.name ?? "", username: last.username ?? "" } : null,
  };
}

export async function updateSettings(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const a = requireMainAdmin(actor);
  const input: Settings = updateSettingsSchema.parse(raw);
  await db.transaction(async (tx) => {
    const current = await getSettings(tx);
    const keys = (Object.keys(SETTING_META) as SettingKey[]).filter((k) => current[k] !== input[k]);
    if (keys.length === 0) return;
    const changes: Record<string, { from: number | boolean; to: number | boolean }> = {};
    for (const k of keys) {
      changes[k] = { from: current[k], to: input[k] };
      await tx
        .insert(settingsTable)
        .values({ key: k, value: input[k], updatedById: a.id, updatedAt: now })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: input[k], updatedById: a.id, updatedAt: now } });
    }
    await audit(tx, { actorId: a.id, action: "settings.update", entityType: "settings", data: { changes } });
  });
}
