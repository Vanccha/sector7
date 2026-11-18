# Kararlar

Kısa, tarihli teknik kararlar. Sonraki oturumlar buradan başlar. İş kuralları için `PROMPT.md`.

## Aşama 1 — Temel (2026-11-18)

### Yığın
- **Next.js 16 (App Router, TypeScript strict, `output: standalone`)**, React 19, Node 24.
- **PostgreSQL 17** (Docker), **Drizzle ORM** + drizzle-kit göçleri (`drizzle/`).
- **Better Auth 1.7** oturum kütüphanesi: username eklentisi, Drizzle adaptörü, veritabanında oturum.
  - Dışarıdan kayıt ve e-posta ile giriş kapalı (`disableSignUp`, `disabledPaths`). Hesaplar yalnız başvuru onayıyla ya da CLI ile sunucuda açılır (`src/server/accounts.ts`), şifre `account` tablosuna `providerId = "credential"` olarak yazılır.
  - Şifre özeti **argon2id** (`@node-rs/argon2`, 19 MiB / 2 tur); Better Auth'un varsayılan scrypt'i yerine `emailAndPassword.password.hash/verify` ile bağlandı.
  - Hız sınırı: Better Auth rate limiter, veritabanında (`rate_limit`), `/sign-in/username` için IP başına 15 dakikada 10 deneme. Yalnız HTTP uç noktasında çalışır; bu yüzden giriş formu `authClient.signIn.username` ile HTTP'den gider (server action'dan `auth.api` çağrılmaz). Üretimde IP, Caddy'nin yazdığı `X-Forwarded-For`'dan okunur; lokalde IP yoksa tek ortak kova kullanılır.
  - Pasif (`user.active = false`) kullanıcılar oturum açamaz (`databaseHooks.session.create.before`).
- **Tailwind kullanılmadı**: görsel dil referanstaki CSS değişkenlerine dayanıyor; düz CSS + token'lar (`src/styles/tokens.css`, `globals.css`) daha doğrudan.
- Test: **Vitest**. Entegrasyon testleri ayrı veritabanında (`sector7_test`, lokal compose'da otomatik oluşur); koşu başında şema sıfırlanır, göçler uygulanır. Test dosyaları sırayla koşar.

### Roller ve yetki
- Roller ayrı tabloda değil, veriden türetilir (`src/lib/contracts/actor.ts`):
  - Ana yönetici: `user.isMainAdmin`. İlki `npm run db:seed` ya da `npm run admin:create` ile açılır; arayüzden yalnız mevcut ana yönetici verebilir (`setMainAdmin`).
  - Alan yöneticisi: `areas.managerId`. **Bir alanın tek yöneticisi** vardır; bir kişi birden çok alanı yönetebilir. Arşivlenmiş alanın yöneticiliği rol vermez.
  - Üye: her aktif kullanıcı; ana alanı `user.homeAreaId`.
- Yetki kontrolü her zaman sunucuda: `getActor()` (`src/lib/auth/session.ts`) + saf kontroller (`src/lib/auth/guards.ts`). Servis fonksiyonları (`src/server/*`) aktörü parametre alır ve kontrolü kendisi yapar; böylece testlerde Next.js olmadan doğrulanır.
- Kişisel veri (e-posta, telefon) yalnız ana yöneticiye görünür; listelenmesi `personal_data.view` olarak denetim kaydına düşer.

### Katmanlar
- `src/db/schema.ts` — tüm şema (sözleşme). Sonraki aşamaların tabloları (sprint, hedef, roadmap, ticket, bağımlılık, talepler, teslim, değerlendirme, kanal, mesaj, bildirim, push, denetim) şimdiden tanımlı; gerektiğinde göçle değişir.
- `src/lib/contracts/*` — paylaşılan tipler, zod şemaları, ayar varsayılanları, hata tipleri (sözleşme).
- `src/server/*` — iş kuralları (Next'ten bağımsız, `db` ve `actor` parametre alır).
- `src/app/**/actions.ts` — ince server action'lar: `getActor()` + servis + `runAction()` ile `ActionResult`.
- Her yazma işlemi aynı transaction içinde `audit()` çağırır.

### Üyelik akışı
- Başvuru: ad soyad, kullanıcı adı, e-posta, telefon, tanıtım. Aynı kullanıcı adıyla aynı anda tek bekleyen başvuru (kısmi benzersiz indeks). Reddedilen başvuru silinmez.
- Onay: hesap açılır, ana alan atanır, **tek kullanımlık şifre bağlantısı** üretilir (7 gün geçerli; sıfırlama bağlantısı 24 saat). Veritabanında yalnız token'ın SHA-256 özeti tutulur; bağlantı onay yanıtında ekranda gösterilir ve sunucu konsoluna yazılır (e-posta gönderimi yok).
- Yeni bağlantı üretilince kişinin eski kullanılmamış bağlantıları geçersiz olur. Sıfırlamada kişinin açık oturumları kapatılır.
- Kullanıcı adı: 3-30 karakter, küçük harf/rakam/`_`/`.`, küçük harfe normalize. Şifre en az 10 karakter.

### Sprint ve tema
- Sprint tüm topluluk için ortak; aynı anda tek aktif sprint (kısmi benzersiz indeks). Hedef/roadmap alan + sprint bazında.
- Sprint günü uygulama saat diliminde (`Europe/Istanbul`) takvim gününe göre hesaplanır; başlangıç günü 1. gün.
- Tema: sprint süresi üç eşit dilime bölünür, `ceil(gün * 3 / süre)` → 1 mavi, 2 kehribar, 3 kırmızı. Kökte `<html data-theme>`.

### Aşama 1 kalite kapısında düzeltilenler
- Kullanıcı adı doğrulaması küçük harfe çevrildikten sonra yapılıyor (`validationOrder: post-normalization`); aksi halde "AYSE" ile giriş 422 alıyordu (test-writer buldu).
- Başvuru onayında tek kullanımlık bağlantı, `revalidatePath` listeyi yenileyince kartla birlikte kayboluyordu; karar sonucu artık üst bileşende tutuluyor (tarayıcıda uçtan uca denemede bulundu).
- Bekleyen sayacı için kişisel veri çekmeyen `countPendingApplications` eklendi (her sekme açılışında sahte `personal_data.view` kaydı yazılıyordu).
- **package-lock.json Linux'ta üretilmeli**: Windows'taki npm, argon2'nin wasm yedeğinin `@emnapi/*` bağımlılıklarını kilit dosyasına yazmıyor ve Docker'da `npm ci` düşüyor. Bağımlılık değişince:
  `docker run --rm -v "${PWD}:/w" -w /w node:24-bookworm-slim npm install --package-lock-only --ignore-scripts`

### Dağıtım
- `docker-compose.prod.yml`: `db` → `migrate` (göçleri uygulayıp çıkar) → `app` (standalone, `node` kullanıcısı) → `caddy` (otomatik HTTPS). Yalnız Caddy port açar; `X-Forwarded-For` Caddy tarafından gerçek IP ile yeniden yazılır (hız sınırı buna güvenir).
- Debian slim taban imaj (argon2 yerel modülü glibc ister).

### Ertelenen
- Gerçek zamanlı iletişim (Aşama 4): PostgreSQL LISTEN/NOTIFY + Server-Sent Events planlanıyor (tek sunucu, ek servis yok).
- Zamanlayıcı (Aşama 3): pg-boss (PostgreSQL üzerinde, ek altyapı gerektirmez) planlanıyor.
