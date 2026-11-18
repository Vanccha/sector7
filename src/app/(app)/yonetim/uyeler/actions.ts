"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { PersonalData } from "@/lib/contracts/admin";
import type { ActionResult } from "@/lib/contracts/errors";
import { issueResetLinkFor, revealPersonalData, setHomeArea, setMainAdminFor, setUserActive } from "@/server/users";

const refresh = () => revalidatePath("/yonetim/uyeler");

export async function revealPersonalDataAction(input: { userId: string }): Promise<ActionResult<PersonalData>> {
  return runAction(async () => revealPersonalData(db, await getActor(), input));
}

export async function setHomeAreaAction(input: { userId: string; areaId: string | null }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setHomeArea(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function issueResetLinkAction(input: { userId: string }): Promise<ActionResult<{ url: string; expiresAt: string; active: boolean }>> {
  return runAction(async () => {
    const r = await issueResetLinkFor(db, await getActor(), input);
    return { url: r.link.url, expiresAt: r.link.expiresAt.toISOString(), active: r.active };
  });
}

export async function setMainAdminAction(input: { userId: string; value: boolean }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setMainAdminFor(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function setUserActiveAction(input: { userId: string; active: boolean }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setUserActive(db, await getActor(), input);
    refresh();
    return undefined;
  });
}
