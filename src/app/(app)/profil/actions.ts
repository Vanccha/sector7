"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import { unlinkGithub } from "@/server/github-link";

/** Bağlı GitHub hesabını koparır. (Bağlama, istemcide authClient.linkSocial ile başlar.) */
export async function unlinkGithubAction(): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await unlinkGithub(db, await getActor());
    revalidatePath("/profil");
    return undefined;
  });
}
