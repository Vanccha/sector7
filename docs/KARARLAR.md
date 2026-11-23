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
  - Aşama 4 notu: host'ta `node_modules` varken bu komut da `@emnapi/*` kayıtlarını düşürebiliyor. Güvenli yol: `package.json` + `package-lock.json`'u `node_modules`'suz geçici bir klasöre kopyala, orada Docker ile lock'u üret ve `npm ci --ignore-scripts` ile doğrula, lock'u geri kopyala. Bağımlılık eklerken host'ta `npm install <paket>` sonrası lock'u bu yolla yeniden üret; `grep -c emnapi package-lock.json` 0 olmamalı.

### Lokal test kolaylıkları (2026-11-18, geliştirici isteği)
- Seed ve `admin:create`, `NODE_ENV !== "production"` iken kısa şifreye izin verir (lokal ana yönetici: `admin`). Üretimde 10 karakter alt sınırı geçerli; başvuru/şifre bağlantısı akışında her ortamda geçerli.
- Giriş hız sınırı `next dev` sırasında kapalı (lokalde IP olmadığından tüm denemeler tek kovaya düşüyordu); testlerde ve üretimde açık.
- Giriş formu sunucu hatasını (5xx) "şifre hatalı"dan ayrı gösterir.

### Dağıtım
- `docker-compose.prod.yml`: `db` → `migrate` (göçleri uygulayıp çıkar) → `app` (standalone, `node` kullanıcısı) → `caddy` (otomatik HTTPS). Yalnız Caddy port açar; `X-Forwarded-For` Caddy tarafından gerçek IP ile yeniden yazılır (hız sınırı buna güvenir).
- Debian slim taban imaj (argon2 yerel modülü glibc ister).

## Aşama 2 — Plan (2026-11-18)

### Geliştiricinin verdiği iş kuralı kararları
- Ön koşul **teslim edilince** (`submitted`) bitmiş sayılır; değerlendirme beklenmez.
- Onaylı roadmap'in basamakları değişirse (ekle/düzenle/sil/sırala) roadmap **yeniden onaya** düşer (`approved → submitted`). Mevcut ticket'lar etkilenmez. Hedeflerin düzenlenmesi roadmap durumunu değiştirmez.
- Bağımlılık **alanlar arası** kurulabilir. Bağlantıyı, bekleyen (bağımlı) ticket'ın alanını yöneten kişi (ya da ana yönetici) kurar ve kaldırır; ön koşul herhangi bir alandan olabilir.
- Sprintleri **ana yönetici elle** açar ve başlatır. Aynı anda tek aktif sprint; kapanış Aşama 3'te.

### Teknik kararlar
- İptal edilen ön koşul bağımlıyı engellemez (aksi halde zincir sonsuza dek kilitlenir). `PREREQ_DONE_STATUSES = submitted, evaluated, cancelled`.
- "Alınabilir" ayrı bir durum değil, hesaplanır: havuzda (`available` / `returned_to_pool`) ve tüm ön koşulları bitmiş.
- Ticket'lar silinmez, **iptal edilir** (denetim kaydı ticket'a bağlı; geçmiş korunur). İptal yalnız kimse almamışken (`draft`, `available`, `returned_to_pool`).
- Ticket yalnız **onaylı** roadmap'in bir basamağından oluşturulur; alanı ve sprinti roadmap'ten gelir. Taslak olarak doğar, alan yöneticisi yayınlayınca havuza girer.
- Ön koşullar yalnız ticket kimse almamışken düzenlenebilir.
- Döngü kontrolü: bağlantı eklenirken `dependsOn`'dan geriye doğru özyinelemeli CTE ile `ticketId`'ye ulaşılıyor mu bakılır; grafik yazımları `pg_advisory_xact_lock` ile sıraya sokulur (eşzamanlı iki ters bağlantı döngü oluşturamaz).
- Düzenleyicideki düğüm konumu (`posX/posY`) yalnız görünümdür, denetim kaydına yazılmaz.
- Bağımlılık düzenleyicisi: masaüstünde React Flow 12 (`@xyflow/react`), mobilde liste + "şundan sonra" seçimi; ikisi aynı action'ları kullanır.
- Alan arşivlemede aktif ticket varsa sunucu önce uyarı döndürür (`archived: false, activeTicketCount`); yönetici onaylarsa ikinci çağrı `confirm: true` ile arşivler. Arşivli alanın yöneticiliği rol vermez ve planı düzenlenemez.
- Geçmişi olan alan silinmez, arşivlenir; hiç geçmişi olmayan (ticket, roadmap, mesaj, üye yok) boş alan ana yönetici tarafından kalıcı silinebilir (yanlışlıkla açılanlar için). `deleteArea` tek transaction'da alanı kilitler; engel varsa `deleted: false, blockers` döner. Yönetici ataması ve depo eşlemesi engel değildir; mesajsız alan kanalı ve okunma kayıtları alanla gider, denetim kayıtları kalır (`areaId` boşalır).

### Ertelenen
- Gerçek zamanlı iletişim (Aşama 4): PostgreSQL LISTEN/NOTIFY + Server-Sent Events planlanıyor (tek sunucu, ek servis yok).
- Zamanlayıcı: Aşama 3'te pg-boss yerine kendi idempotent taraması seçildi (aşağıda).

## Aşama 3 — Ticket döngüsü (2026-11-18)

### Geliştiricinin verdiği iş kuralı kararları
- "Ticket iste" → ticket kişiye önce **teklif** (`offered`) olarak düşer. Kabul → `taken`, 72 saat başlar. Red → sprint başına hak (varsayılan 2) harcanır, ticket havuza döner; red otomatik yeni ticket çekmez, kişi "yenisini iste" der.
- **Red hakkı bittiyse** istenen ticket doğrudan atanır (`taken`, teklif yok). Arayüz istemeden önce ve son reddi yaparken uyarır.
- Cevapsız teklif **30 dk** sonra hak düşmeden havuza döner.
- GitHub: private `sector7` deposu kurulup push edilir.

### Havuz ve teklif
- Havuz: aktif sprintin, arşivsiz alanların alınabilir ticket'ları (`takeableCondition`); kişinin ana alanı **ve yönettiği alanlar** hariç; kişinin bu sprintte reddettikleri hariç. Seçim `ORDER BY random() LIMIT 1 FOR UPDATE OF tickets SKIP LOCKED` — eşzamanlı isteklerde aynı ticket iki kişiye düşmez. Aynı kişinin çift tıklaması `pg_advisory_xact_lock(hashtext('ticket-request:'||userId))` ile sıraya girer; bekleyen teklif varsa yeni çekilmez, o döner.
- Teklif kabulünde süresi geçmişse hata verilir (değişiklik yok); havuza dönüşü zamanlayıcı ya da kişinin bir sonraki isteği yapar.
- Red hakkı ticket'ın sprintine göre sayılır (`ticket_rejections`).

### Süre ve talepler
- Tüm süre matematiği `src/lib/ticket-time.ts`'te: `dueAt` teslim son anı; talep beklerken `pausedAt` dolar, kalan = `dueAt - pausedAt` donar; devamda `dueAt` duraklama kadar ileri itilir (ek süre onayında ayrıca `grantedHours`). dueAt ileri kayınca geçersiz kalan `warnedAt`/`expiredNotifiedAt` temizlenir.
- Talep yalnız ticket'ı yapan kişiden, ticket `taken` iken (süre dolmuş olsa da); ticket başına tek bekleyen talep. Konuşma ticket kanalında (`channels.kind='ticket'`, tembel açılır), mesajlar `requestId` ile bağlı.
- Yönetici soru sorunca `awaitingRequesterAt` dolar ve cevap süresi işlemez; talep sahibi cevaplayınca `respondBy` yeniden başlar, hatırlatma/cevapsız işaretleri sıfırlanır.
- Cevaplayan: alanın yöneticisi ya da ana yönetici, ama talep sahibi değil. Talep otomatik sonuçlanmaz. Talep sahibi bekleyen talebini geri alabilir.
- Geri çekme onayı ticket'ı aynı sprintin havuzuna döndürür.

### Teslim ve değerlendirme
- Teslim: açıklama + 0-10 http(s) bağlantı + 0-5 dosya. Süre dolduktan sonra da teslim edilir (sistem cezalandırmaz). Bekleyen talep varken teslim, talebi geri alır. `submitted` iken yeniden teslim olur, en sonuncusu geçerli; değerlendirildikten sonra teslim yok.
- Dosyalar route handler'la yüklenir (`POST /api/dosya`, server action'ın gövde sınırına takılmasın diye), `UPLOAD_DIR/yyyy/mm/uuid`; sahipsiz doğar, teslimde bağlanır. İndirme `GET /api/dosya/[id]`: sahibi ya da ticket'ı görebilen; diğerlerine 404.
- Değerlendirme: alan yöneticisi/ana yönetici, kendi teslimini değil; değerlendirici başına tek kayıt (güncellenebilir).
- Ticket'ı görebilen: üzerindeki kişi (teklif dahil) ve alanı yönetebilen. Üyeler havuzu listeleyemez.

### Sprint sonu
- Ana yönetici `active → closing` başlatır: sprint aktif olmaktan çıkar (havuz kapanır, yeni sprint başlatılabilir), bekleyen teklifler havuza döner. Bitmemiş = `submitted/evaluated/cancelled` dışındaki her ticket (taslak dahil).
- Kararlar ticket bazında, alan yöneticisi (kendi alanları) ve ana yönetici; hemen uygulanır ve `sprint_end_decisions`'a yazılır. Hedef sprint: aktif sprint (kapanan değilse), yoksa en küçük numaralı planlanmış; yoksa taşıma seçenekleri kullanılamaz.
- Seçenekler kayıtla genişler: `SPRINT_END_OPTIONS` (`appliesTo`, `needsNextSprint`) + `src/server/sprint-end.ts` `HANDLERS` (anahtar tipine bağlı; handler yazılmadan seçenek eklenirse tsc hata verir).
  - Taşı: sprint değişir, durum aynen. Aynı kişide bırak: sonraki sprint, süre yeniden başlar (talep sürüyorsa duruk kalır). Havuza koy: bekleyen talep geri alınır, kişiden alınır. İptal: bekleyen talep geri alınır.
- Tüm bitmemişler karara bağlanınca ana yönetici `closing → closed`.

### Zamanlayıcı
- pg-boss yerine **şemadaki işaret sütunlarıyla idempotent tarama** (`src/server/scheduler.ts` `runScheduledTick`): ek bağımlılık ve tablo yok, aynı anı iki kez taramak ikinci bildirim üretmez, tek sunucuya uygun. Tek transaction, `pg_try_advisory_xact_lock` ile aynı anda tek çalışma.
- Adımlar: teklif dolumu (30 dk), süre uyarısı (`dueAt - ticketWarnBeforeHours`), süre dolumu bildirimi, talep hatırlatması (cevap süresinin son çeyreği), cevapsız işareti (`overdueAt`; yönetici + ana yöneticilere bildirim, panelde öne çıkar). Duraklı ticket'a uyarı yok; yönetici soru sormuşken hatırlatma yok.
- Çalıştırıcı: `src/instrumentation.ts` → Node çalışma ortamında 60 sn'de bir (`SCHEDULER_DISABLED=1` ile kapanır). Elle: `npm run jobs:tick`.

### Bildirimler
- `src/lib/notify.ts` uygulama içi `notifications` satırı yazar, kişinin `notification_prefs.inApp=false` tercihine uyar. Türler `src/lib/contracts/notifications.ts`. Alıcı alan yöneticisi yoksa (ya da talep sahibinin kendisiyse) ana yöneticiler. Push ve gerçek zaman Aşama 4.

## Aşama 4 — İletişim (2026-11-18)

### Geliştiricinin verdiği iş kuralı kararları
- Alan kanallarını **herkes okur ve yazar** (topluluk zaten alanlar arası çalışıyor). Arşivli alanın kanalı salt okunur.
- Mesajlar **düzenlenmez ve silinmez**.
- Bildirim üretenler: **duyurular, ticket konuşması, @bahsetme**. Alan kanalındaki sıradan mesaj yalnız okunmamış sayısını artırır. Kişi her türü uygulama içi ve push için ayrı kapatabilir.

### Erişim
- Duyuru kanalı: herkes okur; ana yöneticiler ve `canAnnounce` verilenler yazar (yetkiyi ana yönetici verir). Tek duyuru kanalı (kısmi benzersiz indeks).
- Ticket konuşması: ticket'ı görebilenler (üzerindeki kişi + alan yöneticisi + ana yöneticiler). Görünmeyen kanal "bulunamadı" döner.
- Ticket kanalında bekleyen talep varken talep sahibinin ya da cevaplayabilenin mesajı talebe bağlanır (Aşama 3'teki talep konuşması kuralları: soru sorulunca cevap süresi durur vb.). Tek konuşma akışı.
- Kurallar tek yerde: `src/server/channel-access.ts`.

### Okunmamış
- `channel_reads (user, channel, lastReadAt)`; okunmamış = son okumadan (yoksa hesabın açıldığı andan) sonra başkasının yazdığı mesajlar.

### Gerçek zaman: PostgreSQL LISTEN/NOTIFY + Server-Sent Events
- Yazma işlemi transaction içinde `pg_notify('sector7_events', json)` çağırır; NOTIFY yalnız commit'te teslim edilir (geri alınan işlem olay üretmez). Yük yalnız kimlik taşır (8000 bayt sınırı); çok alıcılı bildirimde `userIds: "all"`.
- Uygulama sürecinde tek LISTEN bağlantısı (`src/server/realtime/hub.ts`) olayları dağıtır; `GET /api/olaylar` (SSE) her bağlantıya aktörün görebildiklerini süzerek yollar; istemci içeriği ayrıca çeker. Neden: tek sunucu, ek servis/altyapı yok, SSE tarayıcıda kendiliğinden yeniden bağlanır, Caddy'de `flush_interval -1` hazır. Birden çok uygulama örneğinde de çalışır (her örnek kendi LISTEN'ını açar).
- İstemci: sayfa başına tek `EventSource` (`src/components/realtime/live.ts`); yeniden bağlanınca `ready` gelir, ekranlar kaçırdıklarını yeniden çeker.

### Bildirim ve Web Push
- `notify()` satırı yazar ve olay yayınlar. Tercih: uygulama içi ve push kapalıysa satır yok; yalnız push açıksa satır okunmuş doğar; push kapalıysa `pushedAt` dolu doğar.
- Push kuyruğu `notifications.pushedAt`: uygulama sürecindeki dağıtıcı (`src/server/push.ts`) bildirim olayında ve zamanlayıcı her dakika `FOR UPDATE SKIP LOCKED` ile sahiplenip `web-push` (VAPID) ile gönderir; ağ çağrıları transaction dışında; 1 saatten eski kuyruk gönderilmez; 404/410 dönen abonelik silinir. VAPID anahtarları yoksa push sessizce kapalı (uygulama içi çalışır). Anahtar üretimi: `npm run push:keys`.
- Service worker yalnız push için (Aşama 6'da PWA kurulumuyla genişler).

## Aşama 5 — Ana yönetici paneli (2026-11-18)

### Geliştiricinin verdiği iş kuralı kararları
- Üye yönetimi: şifre sıfırlama bağlantısı, ana yönetici ver/al, ana alan değiştir, **pasifleştir/etkinleştir**.
- Pasif kişi giriş yapamaz, açık oturumları silinir. Elindeki ticket'lara **otomatik bir şey olmaz**: panelde "pasif kişide kalan" olarak öne çıkar; alan yöneticisi ya da ana yönetici ticket sayfasından havuza geri alır (`reclaimTicket`, yalnız pasif kişide kalan teklif/sürmekte olan ticket için).

### Teknik kararlar
- Panel (`/yonetim`) aktif sprint kapsamında alan × durum sayaçlarını tek gruplu sorguyla hesaplar; cevapsız talepler, süresi dolanlar, pasif kişide kalanlar, kapanan sprintlerin kararsız sayıları, son değerlendirmeler ve son işlemler öne çıkar.
- Ayarlar tek formda kaydedilir; yalnız değişen anahtarlar yazılır ve denetim kaydına önceki/sonraki değerleriyle düşer. Değişiklik **sonraki işlemlere** uygulanır (ör. yeni teslim süresi yalnız bundan sonra alınan ticket'lara); red hakkı canlı sayıldığı için hemen geçerlidir.
- Denetim kaydı: kişi (yapan ya da etkilenen), alan, ticket, eylem (tam ad ya da grup öneki) ve tarih aralığı (Europe/Istanbul günleri) ile süzülür; id ile sayfalanır; mesaj kayıtlarında mesaj metni gösterilir. CSV dışa aktarma (en fazla 10.000 satır, UTF-8 BOM, formül enjeksiyonuna karşı kaçış).
- Giriş/çıkış artık denetim kaydına yazılır (Better Auth `session.create.after` / `session.delete.after`, yalnız kullanıcının kendi çıkışı). Kayıt yazılamazsa giriş bozulmaz.
- Kişisel veri (e-posta, telefon) listelerde yoktur; tek tek "göster" ile açılır ve her açılış `personal_data.view` olarak kaydedilir.
- Son aktif ana yönetici pasifleştirilemez; kimse kendini pasifleştiremez; pasif kişiye ana yönetici verilemez.

## Aşama 6 — Görsel cila ve PWA (2026-11-18)

- **Mobil gezinme:** ≤720px'te altta sabit sekme çubuğu (Ana sayfa · Ticket'larım · Mesajlar · Bildirimler · Menü; rozetler canlı), "Menü" alt sayfası (Alanlarım, Yönetim, bildirim tercihleri, çıkış). `--bottom-nav-h` ve `env(safe-area-inset-*)` ile çentik/ev çubuğu payı; dokunma hedefi ≥44px. Masaüstünde üst sekmeler.
- **Başlık:** mobilde işaret + BETA + kompakt gün çubuğu/lamba; gün dilimleri kalan alana göre incelir (uzun sprintte taşmaz), çok dar ekranda yalnız yanan lamba. Sol alttaki vurgu çizgisi yalnız mobilde (masaüstünde ilk sekmeyi aktif gibi gösteriyordu).
- **Tema:** tüm renkler token'lardan; kontrast için kehribar temada vurgu üstü yazı koyu (`--on-ac`, `--rec-tx`), yeni `--on-hot` (rozet yazısı). Animasyonlar `prefers-reduced-motion`'a uyar (genel kural).
- **Kıvılcım efekti:** SVG şimşek/dal/halka (yalnız transform/opacity/stroke-dashoffset), ardından teklif kartı düşer; azaltılmış harekette yok.
- **PWA:** `app/manifest.ts` (AllSpark, standalone, kısayollar), ikonlar ikili dosya olmadan `ImageResponse` ile işaret SVG'sinden (192/512/maskable, favicon, apple-touch). `themeColor` aktif sprint temasından (`generateViewport`); aktif sprint istek başına bir kez okunur (`getRequestSprint`, React `cache`).
- **Service worker:** push işleyicilerine ek olarak yalnız `/offline.html` ve `/_next/static/` (değişmez dosyalar) önbelleğe alınır; gezinme ağdan, hata olursa çevrimdışı sayfası. **Oturumlu HTML ve `/api/` asla önbelleğe alınmaz** (kişisel veri). Geliştirmede SW yalnız push açılınca ya da `NEXT_PUBLIC_SW_DEV=1` ile kaydedilir (eski önbellek karışıklığı olmasın).
- **Kurulum daveti:** `beforeinstallprompt` (Chrome/Edge/Android) ya da iOS talimatı; ikinci oturumdan sonra, "Şimdi değil" 14 gün hatırlanır, standalone'da hiç görünmez.
- **Demo verisi:** `npm run db:demo` (yalnız geliştirme, idempotent, mevcut veriye dokunmaz). Havuzda demo dışı ticket varsa demo çekimleri yalnız demo alanlarından yapılır.
- **Doğrulama:** ekranlar demo verisiyle 390px (iframe) ve masaüstü genişliğinde tarayıcıda incelendi; mobil başlıkta gün çubuğunun markayla çakışması, duraklı geri sayımın taşması, Windows'ta görünen yatay kaydırma çubuğu ve masaüstündeki yanıltıcı vurgu çizgisi bu incelemede bulunup düzeltildi.

## Aşama 7 — Geliştirici geri bildirimi (2026-11-18)

### Geliştiricinin verdiği kararlar
- 7.3 canlı çalışma haritası: düğüm şekli **kesik köşeli altıgen** (tek bileşen, şekil değiştirilebilir).
- 7.5 GitHub kimlik: kullanıcı adı + şifre kalır, profilde "GitHub hesabını bağla"; başvuruda GitHub adı isteğe bağlı, ilk ticket kabulünde bağlama zorunlu.
- 7.5 GitHub yapı: **alan başına depo**, içinde sprint sprint kategorize (milestone + `sprint-NN` etiketi + `sprint-NN/` klasör ve dal öneki). Ayrıntı `docs/GITHUB-TASARIM.md`.

### 7.1 PWA kurulum düğmesi
- `beforeinstallprompt` artık modül düzeyinde tek store'da (`src/components/pwa/install-store.ts`, `useInstall()` → `installed | native | ios | unavailable`); hem alttaki davet şeridi hem kalıcı `InstallButton` aynı ertelenen olayı kullanır. Kurulunca ya da standalone'da ikisi de görünmez.
- Düğme: masaüstünde başlığın sağında, mobilde Menü sayfasında. iOS Safari'de `<dialog>` ile "Paylaş → Ana Ekrana Ekle" yönergesi. İstem desteklemeyen tarayıcıda (masaüstü Safari/Firefox) düğme gizli.

### 7.2 Masaüstü yerleşimi
- `.app-main` en geniş 1280px, ortalı; başlık içeriği CSS ile aynı kolona hizalanır (markup değişmedi).
- Sayfa genişliği sistemi `shell.css`: `.page` (tam), `.page--narrow` (720, ortalı; form/ayar), `.page--medium` (860, ortalı; bildirim/konuşma), `.page-grid` (≥721px `auto-fill minmax(320px)`), `.page-split` (≥1024px ana + 300-360px yan; DOM sırası korunur, mobil sırası değişmez). Sayfalardaki inline `maxWidth`'ler kaldırıldı.

### 7.3 Şema — canlı çalışma haritası (`/sema`)
- Herkes görür. Düğümler: alanlar (büyük) ve sürmekte olan ticket'ı (`IN_PROGRESS_STATUSES`) olan aktif kişiler (küçük); bağlantı = kişi → alan (aynı alanda birden çok ticket → tek çizgi + sayı). Yalnız ad, alan, ticket başlığı; e-posta/telefon/kullanıcı adı yok, ticket sayfasına bağlantı yok. Teklif (`offered`) bağlantı sayılmaz.
- Veri `getLiveMap` (`src/server/live-map.ts`, 3 sorgu); sözleşme `src/lib/contracts/live-map.ts`.
- Düğüm tek bileşen: `src/components/schema/Dugum.tsx`, şekil `DEFAULT_NODE_SHAPE` (geliştirici seçimi `hex` = kesik köşeli altıgen; `tri`, `cut-square` hazır). Yeni şekil: `NODE_SHAPES` + `SHAPES` poligonu.
- Yerleşim saf fonksiyon `src/lib/live-map-layout.ts`: alanlar iç elipste eşit açı, kişiler dış elipste bağlı alanların dairesel ortalama açısında; çakışma kalmayana dek halkalar büyür (`layoutHasOverlap`), sonra sınır kutusuna kırpılır; istemci kap genişliğine `scale` (0.5-1) ile sığdırır. Mobilde (<900px) alan başına liste.
- **Gerçek zaman: veritabanı tetikleyicisi.** `tickets_notify_change` (göç 0003) status ya da assignee değişince `pg_notify('sector7_events', {kind:"tickets", areaId})` üretir — uygulamadaki her yazma yolu tek yerden kapsanır, unutulan yayın olmaz; NOTIFY commit'te teslim edilir, aynı transaction'daki özdeş yükler tekilleşir. Olay kişisel veri taşımaz, herkese gider; ekranlar `router.refresh()` ile yeniden çeker (1 sn debounce).
- Drizzle tuzağı: tek tablolu `select` içindeki ham `sql` parçasında `${tickets.id}` nitelemesiz `"id"` olarak yazılabilir ve alt sorgudaki aynı adlı sütuna bağlanır. Alt sorgulu select ifadelerinde dış tabloyu açıkça nitele (`"tickets"."id"`). (`loadStepTickets.blockedCount`'ta tarayıcı denemesinde bulundu.)

### 7.4 Roadmap ilişkileri ve otomatik havuz
- Roadmap basamakları tutamaçtan **sürükle-bırak** ile sıralanır (Pointer Events, dokunmatik + klavye: Boşluk al/bırak, oklar, Esc; `aria-live`). Yeni bağımlılık eklenmedi.
- Her basamak önceki basamakla ilişkisini taşır: `roadmap_steps.after_previous` (göç 0004) — **Paralel** (false) / **Öncekinden sonra** (true). İlişki değişikliği basamak değişikliğidir: onaylı roadmap yeniden onaya düşer.
- Ticket'lara bölerken sıralı basamağın yeni ticket'ı, hemen önceki basamağın iptal edilmemiş ticket'ına otomatik ön koşulla bağlanır (`insertDependencyTx`, denetimde `auto: true`); önceki basamakta ticket yoksa daha geriye bakılmaz. Sonrasında ilişkilerin **tek kaynağı ticket bağımlılıkları**; mevcut ticket'lar basamak ilişkisi değişince etkilenmez.
- Bağlantı yok = paralel. Düzenleyicide kenara tıklayınca "Paralel yap" (= bağlantıyı kaldır). Yayınlanan ama ön koşulu bitmemiş ticket havuzdadır, kimseye düşmez; ön koşul teslim/iptal edilince kendiliğinden alınabilir olur ve herhangi biri çekebilir (atama yok; "paslama" = havuzdan başkasının alabilmesi).
- Görünürlük: basamakta ve ticket listesinde/düzenleyicide durum çipleri (Taslak / Bekliyor · N ön koşul / Alınabilir / …), "Bitince açılacak" (`TicketRow.dependents`). Plan, ticket listesi ve düzenleyici `tickets` olayıyla canlı yenilenir; bağımlılık ekle/kaldır da olay yayınlar.
- Basamağın tek ticket'ı iptal edildiyse "ticket'lara böl" o basamak için yeni ticket açar (mevcut davranış) ve sonraki sıralı basamağın yeni ticket'ı bu yenisine bağlanır: iptal edilen işin yerini alan iş, sıranın yeni halkasıdır.
- Testler: `tests/integration/plan-relations.test.ts` (ilişki, otomatik bağlama, havuz, döngü, eşzamanlılık, yetki, olay), `tests/unit/live-map-layout.test.ts` (0-30 alan/kişi çakışmasızlık, determinizm), `tests/integration/live-map.test.ts` (getLiveMap, tetikleyici).

### 7.5 GitHub — adım 1: hesap bağlama (onaylı kısım)
- Better Auth `socialProviders.github` yalnız `GITHUB_CLIENT_ID/SECRET` tanımlıysa etkin; scope yalnız `read:user` (e-posta alınmaz). **GitHub ile giriş/kayıt yok**: `/sign-in/social` kapalı, böylece OAuth callback'ine yalnız oturumlu kullanıcının `POST /link-social` state'i ulaşır; `disableSignUp`, `disableImplicitSignUp`, `disableImplicitLinking` (e-posta eşleşmesiyle birleştirme yok). `trustedProviders: ["github"]` yalnız e-posta doğrulaması istenmesin diye.
- **Token saklanmaz**: `account.create.before` kancası access token ile `GET api.github.com/user` (User-Agent `SECTOR7`) → `id`, `login`; token sütunları null yazılır; `user.github_id` (benzersiz) / `github_login` / `github_linked_at` dolar, `github.link` denetimi. Aynı GitHub hesabı ikinci kullanıcıya bağlanamaz. `/unlink-account`, `/get-access-token`, `/refresh-token`, `/account-info` kapalı; kaldırma kendi `unlinkGithub`'ımızla (`/profil`).
- Zorunluluk (entegrasyon açıkken): teklif çekmek serbest, **kabul** bağlı hesap ister; red hakkı bitmiş kişinin doğrudan ataması ticket çekilmeden önce reddedilir. Kapalıyken hiçbir kural değişmez.
- Başvuru formunda isteğe bağlı GitHub adı (`applications.github_username`, göç 0005), doğrulanmamış bilgi olarak ana yöneticiye görünür; hesaba kopyalanmaz.
- Lokal deneme: GitHub → Settings → Developer settings → OAuth Apps, callback `http://localhost:3000/api/auth/callback/github`, anahtarları `.env`'e. Adım 2'de (GitHub App) bu OAuth App yerine App'in kullanıcı yetkilendirmesine geçilebilir.
- **Bekleyen karar:** teslim ve senkron (PR ile teslim, disk yüklemesinin geleceği, ticket → issue, webhook) ve App türü. Onaya kadar adım 2+ için kod yok.

### 7.x Geliştirici geri bildirimi: şema yerleşimi, kabul efekti, lamba (2026-11-18)
- **Şema yerleşimi** (geliştirici isteği, iki tur; 2026-11-19 son hâli): **kişiler ortada, alan altıgenleri onları çevreleyen halkada.**
  - Halka-1: alanlar orijin merkezli çember üzerinde eşit açıyla (hex ızgara yok). Aktif alanlar (ad sırasıyla) halkaya **eşit aralıkla** dağılır (tek köşeye toplanmasın), boş alanlar kalan yuvaları ad sırasıyla doldurur; tepe yuvası ilk aktifin. `N1MAX = 14`; fazlası boş alanlar halka-2'ye (yarım adım kaydırılmış), aktifler hep halka-1'de (gerekirse halka büyür). Altıgende alan + yönetici adı + ticket sayısı.
  - Kişiler (tek aktif ticket kuralıyla her kişi tek alana bağlı, 2026-11-19): kendi alanının hemen iç tarafında; aynı alandakiler teğet yönde simetrik kısa sıra (en çok 4, sonra içeri yeni sıra), sıra alanın açı diliminden en çok 1,6 kat geniş. Adımlar eksene hizalı kutulara göre yön hesaplı. Çakışma ya da yabancı altıgen kesişimi olursa halka büyür. Çizgiler kısa ve düz. (Açısal orta / çok alanlı kişi mantığı kaldırıldı.)
- Önceki denemeler (hex petek + dış halkada kişiler, kanal çemberi üzerinden dolanan yaylar, birlikte çalışılan alanları yan yana toplama) geliştirici isteğiyle geri alındı: aktifleri tek köşeye topluyor ve kişileri çevreye dağıtıyordu.
- Yeni bağlantı canlı güncellemede kısa bir şimşekle belirir (ilk yüklemede değil).
- **Kabul efekti**: Aşama 6'nın şimşek/dal/halka efekti `SparkFx` olarak ayrıldı; ticket kabul edilince (teklif kabulü ya da red hakkı bitince doğrudan atama) `body`'ye eklenen bağımsız kökte oynar (sunucu eylemi sayfayı yenileyince kart kalktığı için kartın içinde görünmüyordu). ~800 ms, `aria-live` duyurusu; reduced-motion'da görsel yok.
- **Sprint lambası** sabit yanar (sarı/kırmızıdaki yanıp sönme kaldırıldı). Gün çubuğundaki "bugün" işareti aynen.

### 7.5 GitHub — adım 2-4 (geliştirici onayı: önerilen teslim/senkron, 2026-11-18)
- **GitHub App** (OAuth App değil); installation token'lar bellekte, kısa ömürlü; JWT `node:crypto` ile (yeni bağımlılık yok). Env: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY(_PATH)`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_ORG`, `GITHUB_WEBHOOK_SECRET`. Eksikse senkron kapalı, sistem bugünkü gibi çalışır.
- Alan ↔ depo eşlemesi ana yönetici panelinden (`areas.github_repo`, depo org içinde elle açılır). Sprint = milestone + `sprint-NN` etiketi; iş dalı ve klasör `sprint-NN/<kısa-id>-<slug>`.
- **Senkron kuyruğu (göç 0006):** `github_outbox`, ticket başına tek satır; `tickets` ve `ticket_dependencies` tetikleyicileri doldurur (uygulama kodu kuyruğa yazmaz, her yol kapsanır). İşleyici **durum tabanlı** (`reconcileTicket`): ticket'ın güncel hâlinden issue'nun olması gerekeni hesaplar (başlık, gövde + ön koşullar, etiket, milestone, atanan = gösterge, açık/kapalı); idempotent, ağ çağrıları transaction dışında, `SKIP LOCKED` + kira, üstel geri çekilme; tazelenen satır silinmez. Zamanlayıcıdan sonra dakikada bir + `tickets` olayında kısa gecikmeyle.
- SECTOR7 kaynaktır: GitHub'da issue elle kapatılırsa webhook ticket'ı kuyruğa alır, senkron geri açar. Taslak ticket'ın issue'su yok; iptal → kapalı (not planned), değerlendirildi → kapalı (completed).
- **Webhook** `/api/github/webhook`: HMAC-SHA256 (`timingSafeEqual`), `X-GitHub-Delivery` ile tekrar koruması, org/depo kontrolü. PR → ticket eşlemesi dal önekiyle (kısa kimlik), olmazsa gövdedeki `closes #N`. PR birleşmesi ticket'ı **teslim etmez**; ticket sayfasında "teslime hazır" ipucu.
- **Teslim:** formda ticket'ın PR'ı seçilir (`submissions.pull_request_id`); açıklama yine zorunlu. Sunucu diskine yükleme `uploadsEnabled` ayarıyla kapanır (varsayılan açık, geçiş süresi); mevcut dosyalar korunur ve indirilebilir.

### Tek aktif ticket kuralı (geliştirici kararı, 2026-11-19)
- Bir kişinin aynı anda en fazla bir aktif ticket'ı olur (`IN_PROGRESS_STATUSES`); bekleyen teklif de yeni istemeyi engeller (istek o teklifi döndürür). Teslim edince serbest. PROMPT.md güncellendi.
- Sunucu: `requestTicket` (doğrudan atama dahil) ve `acceptOffer` kişi başına istek kilidi (`ticket-request:<userId>`) içinde `assertActiveLimit` ile denetler; eşzamanlı istekler sıraya girer. DB kısıtı eklenmedi (fikstürler ve eski veri; uygulama düzeyi kilit yeterli). Arayüzde "Kıvılcım çak" pasif + `ACTIVE_LIMIT_MESSAGE`.
- Lokal dev DB'de kuralı aşan iki demo kişinin (demo.uye1, demo.uye2) fazla ticket'ları havuza döndürüldü.
