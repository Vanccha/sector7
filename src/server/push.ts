/** Web Push: abonelikler ve bekleyen bildirimlerin gönderimi. Next.js'e bağımlı değildir. */
import { and, eq, sql } from "drizzle-orm";
import * as webpush from "web-push";
import type { DB, DbOrTx } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { pushEndpointSchema, pushSubscriptionSchema, type PushPayload } from "@/lib/contracts/notifications";

export type PushConfig = { publicKey: string; privateKey: string; subject: string };

export function pushConfig(): PushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || "mailto:admin@localhost" };
}

export async function countPushDevices(db: DbOrTx, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return r?.n ?? 0;
}

export async function savePushSubscription(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const me = requireActor(actor);
  const input = pushSubscriptionSchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx
      .insert(pushSubscriptions)
      .values({ userId: me.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: me.id, p256dh: input.keys.p256dh, auth: input.keys.auth },
      });
    await audit(tx, { actorId: me.id, action: "push.subscribe", entityType: "push_subscription", subjectUserId: me.id });
  });
}

export async function removePushSubscription(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const me = requireActor(actor);
  const input = pushEndpointSchema.parse(raw);
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, me.id)))
      .returning({ id: pushSubscriptions.id });
    if (removed.length > 0) {
      await audit(tx, { actorId: me.id, action: "push.unsubscribe", entityType: "push_subscription", subjectUserId: me.id });
    }
  });
}

export type PushSender = (
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
) => Promise<{ ok: true } | { ok: false; gone: boolean }>;

let vapidKey = "";

export const webPushSender: PushSender = async (sub, payload) => {
  const cfg = pushConfig();
  if (!cfg) return { ok: false, gone: false };
  const key = `${cfg.subject}|${cfg.publicKey}|${cfg.privateKey}`;
  if (key !== vapidKey) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    vapidKey = key;
  }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 3600 },
    );
    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410 };
  }
};

type Claimed = { id: string; user_id: string; type: string; title: string; body: string; link: string | null };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

export async function dispatchPendingPush(
  db: DB,
  now: Date = new Date(),
  sender?: PushSender,
): Promise<{ skipped: boolean; claimed: number; sent: number; removed: number }> {
  if (!sender && !pushConfig()) return { skipped: true, claimed: 0, sent: 0, removed: 0 };
  const send = sender ?? webPushSender;
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const res = await db.execute<Claimed>(sql`
    update notifications set pushed_at = ${now}
    where id in (
      select id from notifications
      where pushed_at is null and created_at > ${since}
      order by created_at
      limit 200
      for update skip locked
    )
    returning id, user_id, type, title, body, link`);
  const rows = res.rows;
  let sent = 0;
  let removed = 0;
  const subsByUser = new Map<string, Sub[]>();
  for (const n of rows) {
    try {
      let subs = subsByUser.get(n.user_id);
      if (!subs) {
        subs = await db
          .select({
            id: pushSubscriptions.id,
            endpoint: pushSubscriptions.endpoint,
            p256dh: pushSubscriptions.p256dh,
            auth: pushSubscriptions.auth,
          })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, n.user_id));
        subsByUser.set(n.user_id, subs);
      }
      const payload: PushPayload = { title: n.title, body: n.body, link: n.link, tag: n.type };
      for (const s of [...subs]) {
        try {
          const r = await send(s, payload);
          if (r.ok) sent++;
          else if (r.gone) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
            subsByUser.set(
              n.user_id,
              (subsByUser.get(n.user_id) ?? []).filter((x) => x.id !== s.id),
            );
            removed++;
          }
        } catch (e) {
          console.error("[push] gönderim hatası:", e);
        }
      }
    } catch (e) {
      console.error("[push] bildirim işlenemedi:", e);
    }
  }
  return { skipped: false, claimed: rows.length, sent, removed };
}
