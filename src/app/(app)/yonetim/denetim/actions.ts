"use server";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { getActor } from "@/lib/auth/session";
import type { AuditPage } from "@/lib/contracts/admin";
import type { ActionResult } from "@/lib/contracts/errors";
import { listAuditLog } from "@/server/audit-log";
import { parseAuditSearchParams } from "./search";

export async function loadMoreAuditAction(input: { query: string; cursor: number }): Promise<ActionResult<AuditPage>> {
  return runAction(async () => {
    const filter = parseAuditSearchParams(new URLSearchParams(input.query));
    return listAuditLog(db, await getActor(), { ...filter, cursor: input.cursor });
  });
}
