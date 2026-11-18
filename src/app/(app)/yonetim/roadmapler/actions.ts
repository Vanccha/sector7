"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import { approveRoadmap, returnRoadmap } from "@/server/plan";

export async function approveRoadmapAction(input: { roadmapId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await approveRoadmap(db, await getActor(), input);
    revalidatePath("/yonetim/roadmapler");
    revalidatePath("/alan/[areaId]", "layout");
    return undefined;
  });
}

export async function returnRoadmapAction(input: {
  roadmapId: string;
  note: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await returnRoadmap(db, await getActor(), input);
    revalidatePath("/yonetim/roadmapler");
    revalidatePath("/alan/[areaId]", "layout");
    return undefined;
  });
}
