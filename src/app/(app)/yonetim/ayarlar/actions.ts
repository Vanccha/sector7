"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import { updateSettings } from "@/server/settings-admin";

export async function updateSettingsAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await updateSettings(db, await getActor(), input);
    revalidatePath("/yonetim/ayarlar");
    return undefined;
  });
}
