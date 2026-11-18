"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import { closeSprint, decideSprintEnd } from "@/server/sprint-end";

export async function decideSprintEndAction(input: {
  sprintId: string;
  ticketId: string;
  decision: string;
  note?: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await decideSprintEnd(db, await getActor(), input);
    revalidatePath(`/sprint/${input.sprintId}/kapanis`);
    revalidatePath("/alan", "layout");
    return undefined;
  });
}

export async function closeSprintAction(input: { sprintId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await closeSprint(db, await getActor(), input);
    revalidatePath("/yonetim/sprintler");
    revalidatePath("/", "layout");
    return undefined;
  });
}
