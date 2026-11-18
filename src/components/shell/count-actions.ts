"use server";
import { db } from "@/db";
import { getActor } from "@/lib/auth/session";
import { unreadMessageCount } from "@/server/messaging";
import { unreadNotificationCount } from "@/server/notifications";

/** Başlık rozetleri için küçük sayım action'ları. Oturum yoksa 0 döner. */
export async function fetchUnreadMessages(): Promise<number> {
  const actor = await getActor();
  if (!actor) return 0;
  try {
    return await unreadMessageCount(db, actor);
  } catch {
    return 0;
  }
}

export async function fetchUnreadNotifications(): Promise<number> {
  const actor = await getActor();
  if (!actor) return 0;
  try {
    return await unreadNotificationCount(db, actor);
  } catch {
    return 0;
  }
}
