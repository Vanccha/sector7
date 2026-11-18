"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import {
  addStep,
  createGoal,
  deleteGoal,
  deleteStep,
  reorderSteps,
  submitRoadmap,
  updateGoal,
  updateStep,
} from "@/server/plan";

type MaybeActor = Awaited<ReturnType<typeof getActor>>;

async function run<T>(fn: (actor: MaybeActor) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(async () => {
    const r = await fn(await getActor());
    revalidatePath("/alan/[areaId]", "layout");
    revalidatePath("/yonetim/roadmapler");
    return r;
  });
}

export async function createGoalAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run((a) => createGoal(db, a, input));
}
export async function updateGoalAction(input: unknown): Promise<ActionResult<undefined>> {
  return run(async (a) => {
    await updateGoal(db, a, input);
    return undefined;
  });
}
export async function deleteGoalAction(input: unknown): Promise<ActionResult<undefined>> {
  return run(async (a) => {
    await deleteGoal(db, a, input);
    return undefined;
  });
}
export async function addStepAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run((a) => addStep(db, a, input));
}
export async function updateStepAction(input: unknown): Promise<ActionResult<undefined>> {
  return run(async (a) => {
    await updateStep(db, a, input);
    return undefined;
  });
}
export async function deleteStepAction(input: unknown): Promise<ActionResult<undefined>> {
  return run(async (a) => {
    await deleteStep(db, a, input);
    return undefined;
  });
}
export async function reorderStepsAction(input: unknown): Promise<ActionResult<undefined>> {
  return run(async (a) => {
    await reorderSteps(db, a, input);
    return undefined;
  });
}
export async function submitRoadmapAction(input: unknown): Promise<ActionResult<undefined>> {
  return run(async (a) => {
    await submitRoadmap(db, a, input);
    return undefined;
  });
}
