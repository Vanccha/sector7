import type { DbOrTx } from "@/db";
import { settings as settingsTable } from "@/db/schema";
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from "@/lib/contracts/settings";

/** Tüm ayarları varsayılanlarla birleştirerek okur. Geçersiz kayıtlı değer varsayılanla değiştirilir. */
export async function getSettings(db: DbOrTx): Promise<Settings> {
  const rows = await db.select().from(settingsTable);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = r.value;
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
