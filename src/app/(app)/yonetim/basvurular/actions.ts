"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import { approveApplication, rejectApplication } from "@/server/applications";

/**
 * Başvuruyu onaylar. Dönen `setupUrl` tek kullanımlık şifre bağlantısıdır; yalnız bu yanıtta
 * görünür, ana yönetici kişiye iletir (lokalde ekranda gösterilir).
 */
export async function approveApplicationAction(input: {
  applicationId: string;
  homeAreaId: string;
}): Promise<ActionResult<{ setupUrl: string; expiresAt: string }>> {
  return runAction(async () => {
    const r = await approveApplication(db, await getActor(), input);
    console.log(`[başvuru onayı] şifre belirleme bağlantısı: ${r.setupUrl}`);
    revalidatePath("/yonetim/basvurular");
    return { setupUrl: r.setupUrl, expiresAt: r.expiresAt.toISOString() };
  });
}

export async function rejectApplicationAction(input: {
  applicationId: string;
  note?: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await rejectApplication(db, await getActor(), input);
    revalidatePath("/yonetim/basvurular");
    return undefined;
  });
}
