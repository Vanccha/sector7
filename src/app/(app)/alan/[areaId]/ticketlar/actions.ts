"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import {
  cancelTicket,
  createTicket,
  createTicketsFromSteps,
  publishTickets,
  updateTicket,
} from "@/server/tickets";

const refresh = () => revalidatePath("/alan/[areaId]", "layout");

export async function createTicketAction(input: {
  roadmapStepId: string;
  title?: string;
  description?: string;
}): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await createTicket(db, await getActor(), input);
    refresh();
    return r;
  });
}

export async function createTicketsFromStepsAction(input: {
  roadmapId: string;
}): Promise<ActionResult<{ created: number }>> {
  return runAction(async () => {
    const r = await createTicketsFromSteps(db, await getActor(), input);
    refresh();
    return r;
  });
}

export async function updateTicketAction(input: {
  ticketId: string;
  title: string;
  description?: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await updateTicket(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function cancelTicketAction(input: { ticketId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await cancelTicket(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function publishTicketsAction(input: { ticketIds: string[] }): Promise<ActionResult<{ published: number }>> {
  return runAction(async () => {
    const r = await publishTickets(db, await getActor(), input);
    refresh();
    return r;
  });
}
