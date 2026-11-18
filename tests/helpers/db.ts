/**
 * Entegrasyon testi yardımcıları. Test veritabanı (DATABASE_URL_TEST) kullanılır.
 * Her test dosyası `beforeEach(resetDb)` ile temiz başlar.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../src/db";
import { areas, sprints, user } from "../../src/db/schema";
import { loadActor } from "../../src/lib/auth/guards";
import type { Actor } from "../../src/lib/contracts/actor";
import { setCredentialPassword } from "../../src/server/accounts";

export { db };

/** Uygulama tablolarını boşaltır (göç tablosu hariç). */
export async function resetDb() {
  const rows = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const names = rows.rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}

const short = () => randomUUID().slice(0, 8);

export async function makeArea(over: Partial<typeof areas.$inferInsert> = {}) {
  const [a] = await db
    .insert(areas)
    .values({ name: `Alan ${short()}`, ...over })
    .returning();
  return a!;
}

export async function makeUser(
  over: Partial<typeof user.$inferInsert> & { password?: string } = {},
) {
  const { password, ...rest } = over;
  const uname = rest.username ?? `u_${short()}`;
  const [u] = await db
    .insert(user)
    .values({
      name: rest.name ?? "Test Kişi",
      email: rest.email ?? `${uname}@example.com`,
      username: uname,
      displayUsername: uname,
      ...rest,
    })
    .returning();
  if (password) await setCredentialPassword(db, u!.id, password);
  return u!;
}

/** Kullanıcıyı oluşturup rolleriyle Actor olarak döndürür. */
export async function makeActor(over: Parameters<typeof makeUser>[0] = {}): Promise<Actor> {
  const u = await makeUser(over);
  return (await loadActor(db, u.id))!;
}

export async function makeMainAdmin(over: Parameters<typeof makeUser>[0] = {}) {
  return makeActor({ isMainAdmin: true, ...over });
}

export async function makeActiveSprint(over: Partial<typeof sprints.$inferInsert> = {}) {
  const [s] = await db
    .insert(sprints)
    .values({ number: 1, name: "Sprint 1", startDate: "2026-11-01", lengthDays: 21, status: "active", ...over })
    .returning();
  return s!;
}

/** Better Auth HTTP uç noktasına istek (giriş, hız sınırı testleri için). */
export async function authRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  const { auth } = await import("../../src/lib/auth/auth");
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
      body: JSON.stringify(body),
    }),
  );
}
