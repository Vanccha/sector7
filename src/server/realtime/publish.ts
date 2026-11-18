import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { REALTIME_CHANNEL, type ServerEvent } from "@/lib/contracts/realtime";

/**
 * Gerçek zaman olayı yayınlar. Transaction içinde çağrılırsa olay yalnız commit'te teslim edilir
 * (geri alınan işlem olay üretmez). Next.js'e bağımlı değildir; testlerde de çalışır.
 */
export async function publishEvent(db: DbOrTx, ev: ServerEvent): Promise<void> {
  await db.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(ev)})`);
}
