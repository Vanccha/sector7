import { inArray, and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { notificationPrefs, notifications } from "@/db/schema";
import type { NotificationInput } from "@/lib/contracts/notifications";
import { NOTIFY_FANOUT_LIMIT } from "@/lib/contracts/realtime";
import { publishEvent } from "@/server/realtime/publish";

/**
 * Bildirim yazar (yazma işlemiyle aynı transaction'da çağrılır) ve gerçek zaman olayı yayınlar.
 * Tercih kuralı: src/lib/contracts/notifications.ts başlığı. Push'u dağıtıcı `pushedAt` boş satırlardan gönderir.
 * Yazılan satır sayısını döndürür.
 */
export async function notify(db: DbOrTx, n: NotificationInput): Promise<number> {
  const ids = [...new Set(n.userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return 0;
  const prefRows = await db
    .select({ userId: notificationPrefs.userId, inApp: notificationPrefs.inApp, push: notificationPrefs.push })
    .from(notificationPrefs)
    .where(and(inArray(notificationPrefs.userId, ids), eq(notificationPrefs.type, n.type)));
  const prefs = new Map(prefRows.map((p) => [p.userId, p]));
  const now = new Date();
  const rows = [];
  for (const userId of ids) {
    const p = prefs.get(userId);
    const inApp = p?.inApp ?? true;
    const push = p?.push ?? true;
    if (!inApp && !push) continue;
    rows.push({
      userId,
      type: n.type,
      title: n.title,
      body: n.body ?? "",
      link: n.link ?? null,
      readAt: inApp ? null : now,
      pushedAt: push ? null : now,
    });
  }
  if (rows.length === 0) return 0;
  await db.insert(notifications).values(rows);
  const recipients = rows.map((r) => r.userId);
  await publishEvent(db, {
    kind: "notification",
    userIds: recipients.length > NOTIFY_FANOUT_LIMIT ? "all" : recipients,
  });
  return rows.length;
}
