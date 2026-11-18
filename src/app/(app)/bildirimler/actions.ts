"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import type { NotificationListView } from "@/lib/contracts/notifications";
import { listNotifications, markNotificationsRead, setNotificationPrefs } from "@/server/notifications";
import { removePushSubscription, savePushSubscription } from "@/server/push";

export async function listNotificationsAction(input: {
  cursor: string | null;
  onlyUnread: boolean;
}): Promise<ActionResult<NotificationListView>> {
  return runAction(async () => listNotifications(db, await getActor(), input));
}

export async function markNotificationsReadAction(input: { ids: string[] }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await markNotificationsRead(db, await getActor(), input);
    revalidatePath("/bildirimler");
    return undefined;
  });
}

export async function setNotificationPrefsAction(input: {
  prefs: { type: string; inApp: boolean; push: boolean }[];
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setNotificationPrefs(db, await getActor(), input);
    revalidatePath("/bildirimler/tercihler");
    return undefined;
  });
}

export async function savePushSubscriptionAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await savePushSubscription(db, await getActor(), input);
    revalidatePath("/bildirimler/tercihler");
    return undefined;
  });
}

export async function removePushSubscriptionAction(input: { endpoint: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await removePushSubscription(db, await getActor(), input);
    revalidatePath("/bildirimler/tercihler");
    return undefined;
  });
}
