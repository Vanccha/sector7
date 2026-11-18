"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import { approveRequest, cancelRequest, createRequest, rejectRequest } from "@/server/ticket-requests";
import { evaluateTicket, submitTicket } from "@/server/delivery";
import { reclaimTicket } from "@/server/users";

const refresh = () => revalidatePath("/", "layout");

export async function createRequestAction(input: {
  ticketId: string;
  kind: "extension" | "withdrawal";
  reason: string;
}): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await createRequest(db, await getActor(), input);
    refresh();
    return r;
  });
}

export async function approveRequestAction(input: {
  requestId: string;
  grantedHours?: number;
  note?: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await approveRequest(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function rejectRequestAction(input: { requestId: string; note?: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await rejectRequest(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function cancelRequestAction(input: { requestId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await cancelRequest(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function submitTicketAction(input: {
  ticketId: string;
  description: string;
  links: string[];
  fileIds: string[];
}): Promise<ActionResult<{ submissionId: string }>> {
  return runAction(async () => {
    const r = await submitTicket(db, await getActor(), input);
    refresh();
    return r;
  });
}

export async function evaluateTicketAction(input: {
  ticketId: string;
  verdict: "good" | "bad";
  comment?: string;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await evaluateTicket(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function reclaimTicketAction(input: { ticketId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await reclaimTicket(db, await getActor(), input);
    refresh();
    return undefined;
  });
}
