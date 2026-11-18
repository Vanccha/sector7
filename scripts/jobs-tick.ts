/**
 * Zamanlanmış taramayı bir kez çalıştırır.
 *   npm run jobs:tick
 */
import { createDb } from "../src/db/index";
import { runScheduledTick } from "../src/server/scheduler";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL tanımlı değil.");
  process.exit(1);
}

const { db, pool } = createDb(url);
runScheduledTick(db)
  .then((r) => console.log(JSON.stringify(r)))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
