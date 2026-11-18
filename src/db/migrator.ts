import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./index";

export async function runMigrations(url: string, migrationsFolder = path.resolve(process.cwd(), "drizzle")) {
  const { db, pool } = createDb(url);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
