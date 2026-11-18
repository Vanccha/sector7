"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import type { TicketRef } from "@/lib/contracts/plan";
import { addDependency, removeDependency, searchPrereqCandidates } from "@/server/dependencies";
import { setTicketPosition } from "@/server/tickets";

const refresh = () => revalidatePath("/alan/[areaId]", "layout");

export async function addDependencyAction(input: {
  ticketId: string;
  dependsOnId: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await addDependency(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function removeDependencyAction(input: {
  ticketId: string;
  dependsOnId: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await removeDependency(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

/** Yalnız görünüm; sayfayı yeniden doğrulamaz. */
export async function setTicketPositionAction(input: {
  ticketId: string;
  x: number;
  y: number;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setTicketPosition(db, await getActor(), input);
    return undefined;
  });
}

export async function searchPrereqCandidatesAction(input: {
  ticketId: string;
  query: string;
}): Promise<ActionResult<TicketRef[]>> {
  return runAction(async () => searchPrereqCandidates(db, await getActor(), input));
}
