// npm run db:migrate — bekleyen göçleri DATABASE_URL'e uygular.
import { runMigrations } from "./migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL tanımlı değil.");
  process.exit(1);
}

runMigrations(url)
  .then(() => console.log("Göçler uygulandı."))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
