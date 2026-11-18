# GitHub entegrasyonu — tasarım önerisi (Aşama 7.5, taslak)

Durum: **kısmen onaylı** (kimlik, depo düzeni). Teslim/senkron ve App türü cevap bekliyor. Bu belge onaylanmadan 7.5 için kod yazılmaz.

## Amaç

- Hesaplar GitHub kimliğiyle bağlansın.
- Ticket'lar (kod olsun olmasın) GitHub üzerinden dönsün; teslim dosyaları sunucu diskinde birikmesin, GitHub kaynak olsun.
- Sistemin iş kuralları (çekme modeli, 72 saat, red hakkı, talepler, değerlendirme) SECTOR7'de kalır. GitHub iş dağıtmaz, yalnız **iş ürününün deposu** ve durum kaynağıdır.

## Önerilen mimari (varsayılanlar; aşağıdaki sorularla kesinleşir)

### 1. Kimlik
- **Karar (geliştirici):** kullanıcı adı + şifre girişi kalır; profilde **"GitHub hesabını bağla"** (OAuth akışı, Better Auth `linkSocial` / account tablosunda `providerId = "github"`). İsteğe bağlı olarak sonradan "GitHub ile giriş" de açılabilir (yalnız bağlı hesaplar için, dışarıdan kayıt yine kapalı).
- Neden: başvuru → onay akışı ve ana yönetici kontrolü bozulmaz; GitHub'ı olmayan/açmak istemeyen üyeler dışlanmaz.
- Başvuru formuna **GitHub kullanıcı adı** alanı eklenir: isteğe bağlı; ilk ticket kabulünde bağlama zorunlu.

### 2. Yapı
- AllSpark için bir **GitHub organizasyonu** (ör. `allspark-dev`). SECTOR7 organizasyona bir **GitHub App** olarak kurulur.
- **Karar (geliştirici): alan başına bir depo, içinde sprint sprint kategorize.** (`alan-tasarim`, `alan-yazilim` …)
  - Her sprint depoda bir **milestone** (`Sprint 7`) ve bir **etiket** (`sprint-07`); ticket'ın issue'su ikisine de bağlanır.
  - Dosyalar sprint klasöründe: `sprint-07/<ticket-kisa-id>-<slug>/`. Ticket'ın işi bir **dal + PR** (`sprint-07/<ticket-kisa-id>-<slug>`).
  - Ticket sonraki sprinte taşınırsa issue'nun milestone/etiketi güncellenir; klasör yeri değişmez (geçmiş bozulmasın).
- Kod dışı işler (tasarım, içerik) aynı düzende; büyük ikili dosyalar için Git LFS / Release asset (aşağıda).

### 3. Teslim
- **Öneri:** teslim = ticket'ın PR'ı (ya da issue'ya bağlı commit/Release asset bağlantısı). SECTOR7 teslim formunda "PR seç" listesi; açıklama SECTOR7'de kalır.
- Sunucu diskine yükleme: **geçiş süresince açık, GitHub'ı bağlı kişiler için gizli**; ayar ile kapatılabilir. Mevcut dosyalar silinmez (geçmiş teslimler).
- Büyük ikili (tasarım kaynak dosyaları, video): LFS kotası org planına bağlı (ücretsiz planda 1 GiB depolama/ay 1 GiB bant). Alternatif: Release asset (dosya başına 2 GiB, kota yok). Öneri: tasarım çıktıları için Release asset, düzenlenebilir kaynaklar için LFS.

### 4. Senkron yönü
| Yön | Ne | Nasıl |
|---|---|---|
| SECTOR7 → GitHub | Ticket yayınlanınca issue açılır (başlık, açıklama, alan etiketi, sprint milestone); bağımlılıklar issue gövdesinde "önce şunlar" listesi; kişi kabul edince issue'ya **atanır** (yalnız gösterge, iş dağıtımı değil); iptal → issue kapanır | App installation token, sunucu tarafında |
| GitHub → SECTOR7 | PR açıldı / birleşti, issue kapandı, commit sayısı | Webhook (`/api/github/webhook`, HMAC imza doğrulaması) |
| Sınır | GitHub'da issue kapatmak ticket'ı **teslim etmez**; teslim ve değerlendirme SECTOR7'de yapılır (iş kuralları tek yerde). PR birleşmesi ticket sayfasında "teslime hazır" ipucu olarak görünür. |

### 5. GitHub App mi, OAuth App mi
- **Öneri: GitHub App** (+ App'in kullanıcı yetkilendirmesi ile hesap bağlama).
  - İnce izinler: Issues R/W, Pull requests R, Contents R/W (yalnız dal/klasör açmak için), Metadata R. Yalnız org depolarına kurulur.
  - Kısa ömürlü installation token'lar (1 saat); kullanıcı adına uzun ömürlü kişisel token saklanmaz.
  - Webhook tek yerden, App ayarında.
- Sırlar: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, dosya yolu ile), `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID/SECRET` yalnız `.env`'de; veritabanında token tutulmaz (kullanıcı bağlantısında yalnız GitHub kullanıcı id'si ve adı).
- Lokal geliştirme: webhook için `gh webhook forward` ya da smee.io; App olmadan sistem bugünkü gibi çalışır (entegrasyon kapalı).

## Aşamalandırma (onaydan sonra)
1. Hesap bağlama + başvuru formunda GitHub adı.
2. App kurulumu, alan ↔ depo eşlemesi (ana yönetici panelinden), ticket → issue senkronu.
3. Webhook: PR/issue durumları ticket sayfasında.
4. Teslimde PR/Release seçimi; disk yüklemesinin ayarla kapatılması.

## Açık sorular
Geliştiriciye soruldu; cevaplar `docs/KARARLAR.md`'ye yazılacak.
