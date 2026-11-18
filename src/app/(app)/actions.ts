"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import type { DrawResult, RejectionQuota } from "@/lib/contracts/tickets";
import { acceptOffer, rejectOffer, requestTicket } from "@/server/pool";

const refresh = () => revalidatePath("/", "layout");

export async function requestTicketAction(): Promise<ActionResult<DrawResult>> {
  return runAction(async () => {
    const r = await requestTicket(db, await getActor());
    refresh();
    return r;
  });
}

export async function acceptOfferAction(input: { ticketId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await acceptOffer(db, await getActor(), input);
    refresh();
    return undefined;
  });
}

export async function rejectOfferAction(input: { ticketId: string }): Promise<ActionResult<RejectionQuota>> {
  return runAction(async () => {
    const r = await rejectOffer(db, await getActor(), input);
    refresh();
    return r;
  });
}
