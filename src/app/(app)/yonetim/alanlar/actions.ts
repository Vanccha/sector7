"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import type { ArchiveResult } from "@/lib/contracts/plan";
import { archiveArea, createArea, setAreaManager, unarchiveArea, updateArea } from "@/server/areas";

const PATH = "/yonetim/alanlar";

export async function createAreaAction(input: { name: string; description: string }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await createArea(db, await getActor(), input);
    revalidatePath(PATH);
    return r;
  });
}

export async function updateAreaAction(input: {
  areaId: string;
  name: string;
  description: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await updateArea(db, await getActor(), input);
    revalidatePath(PATH);
    return undefined;
  });
}

export async function setAreaManagerAction(input: {
  areaId: string;
  managerId: string | null;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setAreaManager(db, await getActor(), input);
    revalidatePath(PATH);
    return undefined;
  });
}

export async function archiveAreaAction(input: {
  areaId: string;
  confirm?: boolean;
}): Promise<ActionResult<ArchiveResult>> {
  return runAction(async () => {
    const r = await archiveArea(db, await getActor(), input);
    if (r.archived) revalidatePath(PATH);
    return r;
  });
}

export async function unarchiveAreaAction(input: { areaId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await unarchiveArea(db, await getActor(), input);
    revalidatePath(PATH);
    return undefined;
  });
}
