"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import type { ArchiveResult, DeleteAreaResult } from "@/lib/contracts/plan";
import { setAreaRepo } from "@/server/github/admin";
import { archiveArea, createArea, deleteArea, setAreaManager, unarchiveArea, updateArea } from "@/server/areas";

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

export async function setAreaRepoAction(input: { areaId: string; repo: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setAreaRepo(db, await getActor(), input);
    revalidatePath(PATH);
    return undefined;
  });
}

export async function deleteAreaAction(input: { areaId: string }): Promise<ActionResult<DeleteAreaResult>> {
  return runAction(async () => {
    const r = await deleteArea(db, await getActor(), input);
    if (r.deleted) revalidatePath(PATH);
    return r;
  });
}
