# SECTOR7 — AllSpark çalışma sistemi

AllSpark öğrenci yazılım topluluğunun iş sistemi: alanlar, sprintler, roadmap'ler, rastgele çekilen ticket'lar, iletişim ve ana yönetici paneli. Durum: **BETA, Aşama 1 (Temel)**.

- İş kuralları: [`PROMPT.md`](PROMPT.md)
- Teknik kararlar: [`docs/KARARLAR.md`](docs/KARARLAR.md)
- Yığın: Next.js 16 · TypeScript · PostgreSQL 17 · Drizzle ORM · Better Auth (kullanıcı adı + şifre, argon2id) · Vitest

## Lokal kurulum (Windows)

Gerekenler: Node 24, npm, Docker Desktop (Compose v2), git.

```powershell
# 1) Bağımlılıklar
npm install

# 2) Ortam dosyası — .env.example'ı kopyalayıp BETTER_AUTH_SECRET'ı değiştir
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # çıkan değeri BETTER_AUTH_SECRET'a yaz

# 3) Veritabanı (Docker Desktop açık olmalı). İlk açılışta test veritabanı da (sector7_test) oluşur.
docker compose up -d db

# 4) Göçler ve başlangıç verisi (örnek alanlar, Sprint 1, ilk ana yönetici)
npm run db:migrate
npm run db:seed

# 5) Uygulama
npm run dev
```

Tarayıcıda <http://localhost:3000>.

- İlk ana yöneticinin kullanıcı adı `.env` içindeki `SEED_ADMIN_USERNAME` (varsayılan `kurucu`), şifresi `SEED_ADMIN_PASSWORD`. Şifre boş bırakılırsa seed rastgele üretip ekrana yazar.
- Başka bir ana yönetici açmak ya da mevcut kişiyi ana yönetici yapmak (yalnız sunucuya erişimi olan kurucu):
  ```powershell
  npm run admin:create -- --username ali --name "Ali Veli" --email ali@example.com
  ```
- Seed tekrar çalıştırılabilir; var olan kayıtları çoğaltmaz.

### Deneme akışı

1. `/basvuru` — dışarıdan başvuru gönder.
2. Ana yöneticiyle `/giris` → **Başvurular** → ana alan seç → **Onayla**. Tek kullanımlık şifre bağlantısı ekranda görünür (ve `npm run dev` konsoluna yazılır).
3. Bağlantıyı aç (`/sifre/...`), şifre belirle, yeni hesapla giriş yap.

### Faydalı komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Tüm testler (birim + entegrasyon) |
| `npm run db:generate` | Şema değişikliğinden yeni göç üretir (`drizzle/`) |
| `npm run db:migrate` | Bekleyen göçleri uygular |
| `npm run db:seed` | Başlangıç verisi |
| `npm run db:studio` | Drizzle Studio (veritabanı gezgini) |

## Testler

```powershell
docker compose up -d db   # veritabanı açık olmalı
npm test
```

- Birim testleri `tests/unit`, veritabanı kullanan entegrasyon testleri `tests/integration`.
- Entegrasyon testleri **ayrı** veritabanını (`DATABASE_URL_TEST`, varsayılan `sector7_test`) kullanır; her koşunun başında bu veritabanı sıfırlanır ve göçler uygulanır. Geliştirme verisine dokunulmaz.
- `sector7_test` yoksa (ör. `dbdata` volume'ü bu betikten önce oluşmuşsa):
  ```powershell
  docker compose exec db psql -U sector7 -c "CREATE DATABASE sector7_test OWNER sector7;"
  ```

## Ubuntu sunucuya dağıtım

Üretim yığını `docker-compose.prod.yml`: `db` (PostgreSQL), `migrate` (göçleri uygulayıp çıkar), `app` (Next.js standalone), `caddy` (ters vekil, otomatik HTTPS). Veritabanı ve uygulama dışarıya port açmaz; yalnız Caddy 80/443 dinler.

1. **Sunucu hazırlığı** (Ubuntu 24.04):
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER   # oturumu kapatıp aç
   sudo ufw allow 22,80,443/tcp && sudo ufw enable
   ```
   Alan adının A/AAAA kaydı sunucuyu göstermeli.
2. **Kod**:
   ```bash
   git clone git@github.com:<hesap>/sector7.git && cd sector7
   cp deploy/.env.prod.example .env
   nano .env   # DOMAIN, POSTGRES_PASSWORD, DATABASE_URL, BETTER_AUTH_SECRET, SEED_ADMIN_* doldur
   ```
3. **Başlat** (göçler `migrate` servisiyle otomatik uygulanır):
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```
4. **İlk ana yönetici ve başlangıç verisi** (bir kez):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm migrate npx tsx src/db/seed.ts
   ```
5. **Güncelleme**:
   ```bash
   git pull
   docker compose -f docker-compose.prod.yml up -d --build
   ```
6. **Yedekleme**: `scripts/backup.sh` veritabanını (`pg_dump`) ve yüklenen dosyaları `backups/` altına alır, eski yedekleri temizler. Günlük cron örneği betiğin başında. Geri yükleme: `scripts/restore.sh <dosya.dump>`.

Kayıtlar: `docker compose -f docker-compose.prod.yml logs -f app`.

## Klasör yapısı

```
src/
  app/            Next.js rotaları — (public): giriş, başvuru, şifre; (app): oturumlu sayfalar
  components/     Arayüz bileşenleri (shell: başlık, BETA, sprint durumu)
  db/             Şema (sözleşme), bağlantı, göç ve seed
  lib/
    auth/         Better Auth yapılandırması, oturum, yetki kontrolleri
    contracts/    Paylaşılan tipler, zod şemaları, ayarlar (sözleşme)
  server/         İş kuralları (Next.js'ten bağımsız, test edilebilir)
  styles/         Tasarım token'ları ve global stiller
drizzle/          Üretilmiş SQL göçleri
tests/            Birim ve entegrasyon testleri
scripts/          Ana yönetici CLI, yedekleme
deploy/           Caddy ve üretim ortam şablonu
referans/         Görsel referans (Kıvılcım Alanı)
.claude/agents/   Alt ajan tanımları (builder, test-writer, ui-builder)
```
