"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts/errors";
import type { MessageView, SendResult } from "@/lib/contracts/messaging";
import { listNewerMessages, listOlderMessages, markChannelRead, sendMessage } from "@/server/messaging";

export async function sendMessageAction(input: { channelId: string; body: string }): Promise<ActionResult<SendResult>> {
  return runAction(async () => sendMessage(db, await getActor(), input));
}

/** Ticket kanalında talep durumu değişebilir; ticket sayfasını tazeler. */
export async function sendTicketMessageAction(input: { channelId: string; body: string }): Promise<ActionResult<SendResult>> {
  return runAction(async () => {
    const r = await sendMessage(db, await getActor(), input);
    revalidatePath("/ticket/[ticketId]", "page");
    return r;
  });
}

export async function listOlderMessagesAction(input: {
  channelId: string;
  beforeId: string;
}): Promise<ActionResult<{ messages: MessageView[]; hasOlder: boolean }>> {
  return runAction(async () => listOlderMessages(db, await getActor(), input));
}

export async function listNewerMessagesAction(input: {
  channelId: string;
  afterId: string | null;
}): Promise<ActionResult<MessageView[]>> {
  return runAction(async () => listNewerMessages(db, await getActor(), input));
}

export async function markChannelReadAction(input: { channelId: string }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await markChannelRead(db, await getActor(), input);
    return undefined;
  });
}
