"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import { setCanAnnounce } from "@/server/announce-access";

export async function setCanAnnounceAction(input: { userId: string; value: boolean }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setCanAnnounce(db, await getActor(), input);
    revalidatePath("/yonetim/duyuru-yetkisi");
    return undefined;
  });
}
