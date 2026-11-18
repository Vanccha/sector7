/**
 * GitHub senkron kuyruğu işleyicisi (Aşama 7.5). Push dağıtıcısı kalıbı: sahiplenme kısa transaction'da
 * (FOR UPDATE SKIP LOCKED + kiralama), ağ çağrıları transaction DIŞINDA. Başarıda satır yalnız okunduğumuz
 * `enqueued_at` ile eşleşiyorsa silinir (bu arada tetikleyici tazelediyse satır kalır).
 */
import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { githubSyncEnabled, GithubError } from "./app";
import { reconcileTicket } from "./sync";

const LEASE_MS = 10 * 60_000;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export type OutboxResult = { processed: number; failed: number; dropped: number };

type Claimed = { ticket_id: string; enq: string };

export function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

/** Kısa, kişisel veri içermeyen hata metni. */
function describeError(e: unknown): string {
  if (e instanceof GithubError) return `GitHub ${e.status || "ağ"}: ${e.message}`.slice(0, 200);
  return "Beklenmeyen hata: " + (e instanceof Error ? e.name : "bilinmiyor");
}

export async function processGithubOutbox(
  db: DB,
  opts: { limit?: number; now?: Date } = {},
): Promise<OutboxResult> {
  const limit = opts.limit ?? 20;
  const now = opts.now ?? new Date();

  if (!githubSyncEnabled()) {
    const res = await db.execute(sql`delete from github_outbox`);
    return { processed: 0, failed: 0, dropped: res.rowCount ?? 0 };
  }

  const claimed = await db.transaction(async (tx) => {
    const res = await tx.execute<Claimed>(sql`
      select ticket_id, enqueued_at::text as enq
      from github_outbox
      where next_attempt_at <= ${now}
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    `);
    const rows = res.rows;
    if (rows.length === 0) return rows;
    const lease = new Date(now.getTime() + LEASE_MS);
    for (const r of rows) {
      await tx.execute(sql`update github_outbox set next_attempt_at = ${lease} where ticket_id = ${r.ticket_id}`);
    }
    return rows;
  });

  let processed = 0;
  let failed = 0;
  for (const r of claimed) {
    try {
      await reconcileTicket(db, r.ticket_id);
      await db.execute(
        sql`delete from github_outbox where ticket_id = ${r.ticket_id} and enqueued_at = ${r.enq}::timestamptz`,
      );
      processed++;
    } catch (e) {
      failed++;
      if (e instanceof GithubError && [403, 404, 422].includes(e.status)) {
        console.warn(`[github] kalıcı hata (${e.status}) ticket ${r.ticket_id}: ${e.message}`);
      }
      try {
        // attempts + 1 sonrası değere göre geri çekilme; satır bu arada tazelendiyse dokunulmaz.
        await db.execute(sql`
          update github_outbox
          set attempts = attempts + 1,
              next_attempt_at = ${now}::timestamptz + (least(${BASE_BACKOFF_MS}::bigint * power(2, attempts), ${MAX_BACKOFF_MS}::bigint) * interval '1 millisecond'),
              last_error = ${describeError(e)}
          where ticket_id = ${r.ticket_id} and enqueued_at = ${r.enq}::timestamptz
        `);
      } catch (e2) {
        console.error("[github] hata kaydı yazılamadı:", e2 instanceof Error ? e2.message : e2);
      }
    }
  }
  return { processed, failed, dropped: 0 };
}
