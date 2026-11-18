/** Bildirim listesi ve tercihler. Next.js'e bağımlı değildir. */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { notificationPrefs, notifications } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import {
  NOTIFICATION_LABELS,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_TYPES,
  listNotificationsSchema,
  markNotificationsReadSchema,
  setNotificationPrefsSchema,
  type NotificationListView,
  type NotificationSettingsView,
  type NotificationType,
  type NotificationView,
} from "@/lib/contracts/notifications";
import { countPushDevices, pushConfig } from "./push";

export async function unreadNotificationCount(db: DbOrTx, actor: Actor | null): Promise<number> {
  const me = requireActor(actor);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function listNotifications(db: DB, actor: Actor | null, raw: unknown): Promise<NotificationListView> {
  const me = requireActor(actor);
  const input = listNotificationsSchema.parse(raw ?? {});
  const conds = [eq(notifications.userId, me.id)];
  if (input.onlyUnread) conds.push(isNull(notifications.readAt));
  if (input.cursor) {
    // Karşılaştırma veritabanında (mikrosaniye); JS Date milisaniyeye kestiği için aynı anda yazılan
    // bildirimler sayfa sınırında kaybolurdu. Başkasının ya da olmayan cursor sonuç vermez → ilk sayfa.
    const [c] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, input.cursor), eq(notifications.userId, me.id)))
      .limit(1);
    if (c) {
      conds.push(
        sql`(${notifications.createdAt}, ${notifications.id}) < (select n.created_at, n.id from notifications n where n.id = ${c.id})`,
      );
    }
  }
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATION_PAGE_SIZE + 1);
  const page = rows.slice(0, NOTIFICATION_PAGE_SIZE);
  const items: NotificationView[] = page.map((n) => ({
    id: n.id,
    type: n.type as NotificationType,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }));
  return {
    items,
    unread: await unreadNotificationCount(db, me),
    nextCursor: rows.length > NOTIFICATION_PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function markNotificationsRead(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const me = requireActor(actor);
  const { ids } = markNotificationsReadSchema.parse(raw ?? {});
  const conds = [eq(notifications.userId, me.id), isNull(notifications.readAt)];
  if (ids.length > 0) conds.push(inArray(notifications.id, ids));
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(...conds));
}

export async function getNotificationSettings(db: DB, actor: Actor | null): Promise<NotificationSettingsView> {
  const me = requireActor(actor);
  const rows = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, me.id));
  const byType = new Map(rows.map((r) => [r.type, r]));
  const cfg = pushConfig();
  return {
    prefs: NOTIFICATION_TYPES.map((type) => {
      const r = byType.get(type);
      return { type, label: NOTIFICATION_LABELS[type], inApp: r?.inApp ?? true, push: r?.push ?? true };
    }),
    push: {
      available: cfg !== null,
      publicKey: cfg?.publicKey ?? null,
      deviceCount: await countPushDevices(db, me.id),
    },
  };
}

export async function setNotificationPrefs(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  void now;
  const me = requireActor(actor);
  const { prefs } = setNotificationPrefsSchema.parse(raw);
  const last = new Map(prefs.map((p) => [p.type, p]));
  await db.transaction(async (tx) => {
    const old = new Map(
      (await tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, me.id))).map((r) => [r.type, r]),
    );
    const changed: string[] = [];
    for (const p of last.values()) {
      const o = old.get(p.type);
      if ((o?.inApp ?? true) === p.inApp && (o?.push ?? true) === p.push) continue;
      changed.push(p.type);
      await tx
        .insert(notificationPrefs)
        .values({ userId: me.id, type: p.type, inApp: p.inApp, push: p.push })
        .onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.type], set: { inApp: p.inApp, push: p.push } });
    }
    if (changed.length > 0) {
      await audit(tx, {
        actorId: me.id,
        action: "notification.prefs_update",
        entityType: "notification_prefs",
        entityId: me.id,
        subjectUserId: me.id,
        data: { types: changed },
      });
    }
  });
}
