/**
 * npm run db:seed — idempotent başlangıç verisi:
 *  - varsayılan ayarlar, örnek alanlar (+ alan kanalları), duyuru kanalı, aktif ilk sprint
 *  - ilk ana yönetici (SEED_ADMIN_* ortam değişkenlerinden)
 * Gerçek alanlar ve yöneticiler sonradan ana yönetici panelinden girilir.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "./index";
import { areas, channels, settings, sprints } from "./schema";
import { DEFAULT_SETTINGS } from "@/lib/contracts/settings";
import { localDateString } from "@/lib/sprint";
import { createMainAdminAccount } from "@/server/accounts";

export const SAMPLE_AREAS = [
  { name: "Yazılım", description: "Web, mobil ve sunucu tarafı geliştirme." },
  { name: "Tasarım", description: "Arayüz, görsel kimlik ve kullanıcı deneyimi." },
  { name: "İçerik", description: "Yazı, video ve sosyal medya." },
  { name: "Donanım", description: "Elektronik, gömülü sistemler ve prototipleme." },
];

export async function seed(db: DB, opts: { admin?: { username: string; name: string; email: string; password: string } } = {}) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing();
  }

  const existingAreas = await db.select({ id: areas.id, name: areas.name }).from(areas);
  for (const a of SAMPLE_AREAS) {
    let area = existingAreas.find((x) => x.name === a.name);
    if (!area) {
      const [row] = await db.insert(areas).values(a).returning({ id: areas.id, name: areas.name });
      area = row;
    }
    if (area) {
      await db
        .insert(channels)
        .values({ kind: "area", areaId: area.id, name: area.name })
        .onConflictDoNothing();
    }
  }

  const [ann] = await db.select({ id: channels.id }).from(channels).where(eq(channels.kind, "announcement")).limit(1);
  if (!ann) await db.insert(channels).values({ kind: "announcement", name: "Duyurular" });

  const [anySprint] = await db.select({ id: sprints.id }).from(sprints).limit(1);
  if (!anySprint) {
    await db.insert(sprints).values({
      number: 1,
      name: "Sprint 1",
      startDate: localDateString(),
      lengthDays: DEFAULT_SETTINGS.sprintLengthDays,
      status: "active",
    });
  }

  if (opts.admin) return createMainAdminAccount(db, opts.admin);
  return null;
}

// Komut satırından çalıştırma
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("src/db/seed.ts");
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL tanımlı değil.");
    process.exit(1);
  }
  const { db, pool } = createDb(url);
  const username = process.env.SEED_ADMIN_USERNAME || "kurucu";
  let password = process.env.SEED_ADMIN_PASSWORD || "";
  const generated = !password;
  if (generated) password = randomBytes(12).toString("base64url");
  seed(db, {
    admin: {
      username,
      name: process.env.SEED_ADMIN_NAME || "Kurucu",
      email: process.env.SEED_ADMIN_EMAIL || `${username}@example.com`,
      password,
    },
  })
    .then((r) => {
      console.log("Seed tamam: ayarlar, örnek alanlar, kanallar, Sprint 1.");
      if (r) {
        console.log(`Ana yönetici: ${username} (${r.created ? "oluşturuldu" : "güncellendi"})`);
        if (generated) console.log(`Üretilen şifre: ${password}  — ilk girişten sonra saklayın.`);
      }
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
