"use server";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import type { ApplicationInput } from "@/lib/contracts/applications";
import type { ActionResult } from "@/lib/contracts/errors";
import { submitApplication } from "@/server/applications";

/** Başvuru formu gönderimi. Alan hataları `fields` içinde döner (fullName, username, email, phone, intro). */
export async function submitApplicationAction(input: ApplicationInput): Promise<ActionResult<{ id: string }>> {
  return runAction(() => submitApplication(db, input));
}
