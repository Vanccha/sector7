import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
/** Bir işlem (transaction) içindeki ya da dışındaki veritabanı tutamacı. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

export function createDb(url: string): { db: DB; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

const globalForDb = globalThis as unknown as { __sector7Db?: { db: DB; pool: Pool } };

function instance() {
  if (!globalForDb.__sector7Db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL tanımlı değil (.env dosyasına bakın).");
    globalForDb.__sector7Db = createDb(url);
  }
  return globalForDb.__sector7Db;
}

/**
 * Uygulamanın paylaşılan veritabanı bağlantısı. İlk kullanımda açılır;
 * geliştirme sırasında sıcak yeniden yüklemede tek havuz korunur.
 */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = instance().db as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export { schema };
