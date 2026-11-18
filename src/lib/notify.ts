import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { notificationPrefs, notifications } from "@/db/schema";
import type { NotificationInput } from "@/lib/contracts/notifications";

/**
 * Uygulama içi bildirim yazar (yazma işlemiyle aynı transaction'da çağrılır).
 * Kişi bu türün uygulama içi bildirimini kapattıysa yazılmaz. Push/gerçek zaman Aşama 4.
 * Yazılan alıcı sayısını döndürür.
 */
export async function notify(db: DbOrTx, n: NotificationInput): Promise<number> {
  const ids = [...new Set(n.userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return 0;
  const off = await db
    .select({ userId: notificationPrefs.userId })
    .from(notificationPrefs)
    .where(
      and(inArray(notificationPrefs.userId, ids), eq(notificationPrefs.type, n.type), eq(notificationPrefs.inApp, false)),
    );
  const muted = new Set(off.map((o) => o.userId));
  const to = ids.filter((id) => !muted.has(id));
  if (to.length === 0) return 0;
  await db.insert(notifications).values(
    to.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? "", link: n.link ?? null })),
  );
  return to.length;
}
