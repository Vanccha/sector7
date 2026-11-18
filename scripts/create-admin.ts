/**
 * Ana yönetici oluşturur ya da mevcut bir kullanıcıyı ana yönetici yapar.
 *   npm run admin:create -- --username kurucu --name "Ad Soyad" --email a@b.c [--password ...]
 * Şifre verilmezse rastgele üretilir ve ekrana yazılır.
 */
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { createDb } from "../src/db/index";
import { createMainAdminAccount } from "../src/server/accounts";

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
  },
});

if (!values.username || !values.name || !values.email) {
  console.error('Kullanım: npm run admin:create -- --username <ad> --name "<Ad Soyad>" --email <e-posta> [--password <şifre>]');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL tanımlı değil.");
  process.exit(1);
}

const password = values.password || randomBytes(12).toString("base64url");
const { db, pool } = createDb(url);
// Kısa şifreye yalnız lokal test aşamasında izin verilir (NODE_ENV=production'da yok sayılır).
createMainAdminAccount(db, { username: values.username, name: values.name, email: values.email, password, allowWeak: true })
  .then((r) => {
    console.log(`Ana yönetici ${r.created ? "oluşturuldu" : "güncellendi"}: ${values.username}`);
    if (!values.password) console.log(`Şifre: ${password}`);
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
