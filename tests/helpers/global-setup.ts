// Test koşusunun başında bir kez: test veritabanını sıfırlar ve göçleri uygular.
import { Client } from "pg";
import { runMigrations } from "../../src/db/migrator";

export default async function setup() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // ortam değişkenleri doğrudan verilmiş olabilir
  }
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST tanımlı değil (.env).");
  if (url === process.env.DATABASE_URL) throw new Error("DATABASE_URL_TEST, DATABASE_URL ile aynı olamaz.");
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await c.end();
  await runMigrations(url);
}
