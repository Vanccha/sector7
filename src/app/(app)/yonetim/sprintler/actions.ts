"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import { createSprint, startSprint, updateSprint } from "@/server/sprints";

const PATH = "/yonetim/sprintler";

export async function createSprintAction(input: {
  startDate: string;
  lengthDays?: number;
  name?: string;
}): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await createSprint(db, await getActor(), input);
    revalidatePath(PATH);
    return r;
  });
}

export async function updateSprintAction(input: {
  sprintId: string;
  startDate: string;
  lengthDays: number;
  name: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await updateSprint(db, await getActor(), input);
    revalidatePath(PATH);
    revalidatePath("/", "layout");
    return undefined;
  });
}

export async function startSprintAction(input: { sprintId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await startSprint(db, await getActor(), input);
    revalidatePath(PATH);
    revalidatePath("/", "layout");
    return undefined;
  });
}
