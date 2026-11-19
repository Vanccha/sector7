# Görev: AllSpark çalışma sistemi (SECTOR7)

## Rol

Deneyimli bir full-stack mühendisi, ürün tasarımcısı ve bu projenin teknik lideri olarak çalışıyorsun. AllSpark adlı öğrenci yazılım topluluğunun iş sistemini sıfırdan kuracaksın. Küçük, doğrulanabilir aşamalarla ilerle; her aşamanın sonunda çalışan bir sürüm, nasıl test edildiği ve sıradaki adım olsun. Belirsiz bir kuralla karşılaşırsan uydurma: "Açık kararlar" bölümüne bak, orada yoksa sor.

## Bağlam

AllSpark, Teknofest odağından çıkıp her alanda üreten bir yazılım topluluğuna dönüşüyor. Sistemin felsefesi: herkes kendi alanı dışındaki işleri yaparak birçok alanda yetkinlik kazanır. Başarısız olmak serbesttir; sistem cezalandırmaz, yıpratmaz. Üyeler öğrencidir, çoğu telefondan girecek.

## Çalışma ortamı

- Proje bu klasörde kurulur (`SECTOR7`). İlk deneme geliştiricinin Windows makinesinde, lokalde çalışacak. Kurulu olanlar: Node 24, npm, Docker Desktop (Compose v2), git, GitHub CLI (`gh`, oturum açık). Lokal PostgreSQL kurulu değil; veritabanı Docker ile çalışır.
- Lokal geliştirme: `docker compose up -d db` ile PostgreSQL, uygulama `npm run dev` ile host'ta. Üretim için tam Compose dosyası (uygulama + veritabanı + ters vekil) da hazırlanır; ileride kendi Ubuntu sunucumuza gidecek.
- Git ve GitHub: klasörde git deposu başlat (ana dal `main`). GitHub'da `sector7` adında **private** bir depo oluştur ve bağla (`gh repo create sector7 --private --source=. --remote=origin`). Aynı adla depo zaten varsa üzerine yazma, dur ve sor. Her aşama bittiğinde anlamlı mesajlarla commit et ve `main`'e push et. `.env` ve sırlar asla commit edilmez; `.env.example` commit edilir.
- Görsel referans: `referans/kivilcim-alani.html` (aşağıda "Görsel dil"). Tarayıcıda açıp incele; renk, tipografi, şekil ve efektleri buradan çıkar.

## Çalışma stratejisi (Opus yönetir, Sonnet alt ajanlar)

Bu oturumu yöneten model sensin (Opus). Kod yazımının büyük kısmını Sonnet alt ajanlarına dağıtırsın; mimari, sözleşmeler ve kalite kapısı sende kalır.

1. **İlk iş alt ajanları tanımla.** `.claude/agents/` altında şu dosyaları oluştur (frontmatter'da `model: sonnet`), sonra commit et:
   - `builder`: Kendisine verilen, dosya sınırları belli bir dilimi uygular; yalnız listelenen dosyalara dokunur; bitince değişen dosyaları, çalıştırdığı komutları ve test sonucunu raporlar.
   - `test-writer`: Verilen kuralların testlerini yazar ve çalıştırır (birim + entegrasyon); uygulama koduna dokunmaz, bulduğu hatayı raporlar.
   - `ui-builder`: Tasarım token'larına ve referans dosyasına sadık kalarak ekran/bileşen yazar; mobil önce.
   - Kod tabanında geniş arama gerektiğinde yerleşik `Explore` ajanını kullan.
2. **Temeli seri ve kendin kur.** Aşama 1'deki şema, kimlik/yetki modeli, klasör yapısı, tasarım token'ları ve paylaşılan tipler/API sözleşmeleri sende. Alt ajanlar bu sözleşmelerin üzerine çalışır; sözleşmeyi alt ajan değiştirmez.
3. **Sonra paralelleştir.** Her aşamayı birbirinin dosyalarına dokunmayan dilimlere böl (ör. sunucu işlemleri / ekranlar / testler). Bağımsız dilimleri aynı anda ayrı alt ajanlara ver. Aynı dosyaya iki ajan yazmaz. Her görevde: amaç, dokunulacak dosyalar, uyulacak sözleşme, bitti tanımı.
4. **Kalite kapısı sende.** Her dilimden sonra diff'i kendin gözden geçir; tip kontrolü (`tsc --noEmit`), lint ve testler yeşil olmadan aşamayı kapatma. Yetki kontrolleri ve iş kuralları (rastgele çekme, red hakkı, bağımlılıklar, süreler) için `test-writer`'ı her zaman çalıştır.
5. **Bağlamı koru.** Uzun dosya dökümlerini kendi bağlamına çekme; alt ajanlardan özet iste. Kararlarını `docs/KARARLAR.md`'ye kısa kısa yaz ki sonraki oturumlar bilsin.
6. **Sor, uydurma.** İş kuralında belirsizlik çıkarsa geliştiriciye sor; teknik detaylarda kendi gerekçeli kararını ver ve `docs/KARARLAR.md`'ye yaz.

## Roller

- **Ana yönetici:** Tüm sistemi görür. Roadmap'leri onaylar, üye başvurularını onaylar, ticket'ları değerlendirebilir, alanları yönetir, her mesajı ve işlemi dashboard'dan izler. Ana yönetici hesaplarını kurucu belirler: ilk ana yönetici seed/CLI komutuyla oluşturulur; arayüzden ana yönetici yetkisi vermek yalnız mevcut ana yöneticiye açıktır.
- **Alan yöneticisi:** Bir alanın (departmanın) başındadır. Alanının sprint hedeflerini ve roadmap'ini yazar, onaylanan roadmap'i ticket'lara böler, alanının ticket'larını takip eder ve değerlendirir. Aynı zamanda bir üye gibi başka alanlardan ticket alıp yapar.
- **Üye:** Bir ana alanı vardır. Yalnız başka alanların ticket'larını alır ve yapar.

Bir kişi birden fazla role sahip olabilir (ana yönetici aynı zamanda alan yöneticisi olabilir).

## Alan kuralları

### Alanlar
- Alanlar (departmanlar) sabit değildir. Ana yönetici panelinden istenen zaman alan eklenir, adı/açıklaması düzenlenir, alan arşivlenir ve alan yöneticisi atanır/değiştirilir.
- Alan silinmez, arşivlenir: geçmiş ticket'ları, mesajları ve kayıtları korunur. Aktif ticket'ı olan bir alan arşivlenmeden önce uyarı gösterilir.

### Sprint
- Varsayılan süre 21 gün; ayarlardan değiştirilebilir (test aşamasında değişebilir).
- Sprint günü, sprint başlangıcından bugüne göre hesaplanır ve arayüzün temasını belirler (bkz. Görsel dil).
- **Sprint sonunda bitmemiş ticket'lar için karar ucu açıktır.** Sistem otomatik bir şey yapmaz; sprint kapanırken bitmemiş ticket'ları listeler. Alan yöneticisi ve ana yöneticiler ticket bazında karar verir: sonraki sprinte taşı, aynı kişide bırak, havuza geri koy ya da iptal et. Bu seçenekler sonradan değişebilir; kodu yeni seçenek eklenebilecek şekilde kur.

### Hedef ve roadmap
1. Alan yöneticisi sprint için hedef(ler) yazar: hedef nedir, ulaşmak için ne gerekir.
2. Hedefe giden yol roadmap'e dökülür: basamaklar.
3. Roadmap ana yöneticinin onayına gider. Ana yönetici onaylar ya da notla geri gönderir.
4. Onaylanan roadmap'i alan yöneticisi kendisi ticket'lara böler; yapay zeka bölmez. Genelde her basamak bir ticket'tır.

### Ticket bağımlılıkları
- Bazı ticket'lar sıralıdır (A bitmeden B alınamaz), bazıları paraleldir.
- Bağımlılıklar yönlü, döngüsüz bir grafiktir (DAG). Döngü oluşturan bağlantı engellenir.
- Yalnız tüm ön koşulları tamamlanmış ticket'lar havuzda "alınabilir" olur.
- Alan yöneticisi bunu kolay düzenleyebilmeli: masaüstünde ticket'ları sürükleyip bağlayarak sıralı/paralel ilişkiyi kurduğu görsel bir düzenleyici (ör. React Flow). Mobilde listeden "şundan sonra" seçimiyle düzenlenebilmeli.

### Ticket alma (çekme modeli)
- Atama yoktur. Üye müsait olduğunda "ticket iste" der; sistem ona rastgele bir ticket verir.
- Rastgele havuz: üyenin ana alanı dışındaki alanlardan, şu an alınabilir durumdaki ticket'lar. Seçim bilinçli olarak tam rastgeledir. Eşzamanlı isteklerde aynı ticket iki kişiye düşmemeli (veritabanı kilidi/işlem).
- Kişi aynı anda yalnız **bir** aktif ticket'a sahip olabilir (alındı ve yan durumları: ek süre / geri çekme bekliyor; bekleyen teklif de yeni istemeyi engeller). Teslim edince serbest kalır, değerlendirmeyi beklemez. Her ticket'a zaten 72 saat verilir. *(Geliştirici kararı, 2026-11-19; önceki kural: birden fazla aktif ticket.)* Kapasite, doluluk oranı ya da yük hesabı yoktur.
- **Red hakkı:** Gelen ticket'ı beğenmeyen kişi sprint başına 2 kez reddedip yenisini isteyebilir. Kalan hak arayüzde görünür. Reddedilen ticket havuza döner ve başkasının almasını bekler.
- **Kabul edilen ticket bırakılamaz.** Kişi öngöremediği bir yoğunluk çıkarsa alan yöneticisine uygulama içinden "bu süreçte yapamayacağım, ticket'ı benden geri çek" diye **geri çekme talebi** gönderir. Karar alan yöneticisinindir; onaylarsa ticket havuza döner.

### 72 saat ve ek süre
- Ticket'ı alan kişinin 72 saati vardır; geri sayım hem kartta hem ticket sayfasında görünür.
- Ek süre: kişi uygulama içinden sebep yazarak ticket'ın alan yöneticisine ek süre talebi gönderir. Bu, ticket'a bağlı karşılıklı bir konuşmadır; alan yöneticisi süre belirleyerek onaylar, reddeder ya da soru sorar.
- Kalan süre azaldığında (ör. 12 saat) ve dolduğunda bildirim gider.

### Alan yöneticisinin cevap sorumluluğu
- Ek süre ve geri çekme taleplerine alan yöneticisi belirli bir sürede cevap vermek zorundadır (varsayılan 24 saat, ayarlardan değiştirilebilir). Bu yöneticinin sorumluluğudur.
- Sistem talep bekletilmez: yöneticiye hatırlatma gönderir; süre aşılınca talep ana yönetici dashboard'unda "cevapsız" olarak öne çıkar. Talep otomatik onaylanmaz ya da reddedilmez. Talep beklerken ticket'ı yapan kişinin geri sayımı durur (kişi yöneticinin gecikmesinden zarar görmez).

### Teslim ve değerlendirme
- Teslim: açıklama + bağlantı(lar) + isteğe bağlı dosya.
- Değerlendirmeyi ticket'ın ait olduğu alanın yöneticisi ve ana yöneticiler yapar: "iyi oldu / kötü oldu" + isteğe bağlı kısa yorum.
- "Kötü oldu" ceza değildir; puan düşürmez, kimseyi sistemden atmaz. Yalnız kayıt ve geri bildirimdir.
- Ticket durumları: taslak → alınabilir → alındı → teslim edildi → değerlendirildi. Yan durumlar: ek süre bekliyor, geri çekme bekliyor, havuza döndü, iptal.

### Üyelik ve giriş
- Giriş **kullanıcı adı + şifre** ile. Şifreler güçlü bir algoritmayla (argon2 ya da bcrypt) saklanır; giriş denemelerine hız sınırı konur; şifre sıfırlama ana yönetici üzerinden yapılabilir.
- Şimdilik alım yalnız ana yöneticilerde. Dışarıdan "başvuru formu" ile gelinir. Formda en az: ad soyad, istenen kullanıcı adı, **e-posta**, **telefon numarası**, kısa tanıtım/ilgi alanları.
- Ana yönetici başvuruyu onaylarsa hesap açılır, ana alanı ana yönetici tarafından atanır ve kişi şifresini belirleyeceği tek kullanımlık bir bağlantı alır (lokalde bu bağlantı ekranda/konsolda gösterilebilir). Reddedilen başvuru kayıtta kalır.
- Telefon ve e-posta kişisel veridir: yalnız ana yöneticiler görür; denetim kaydına düşen görüntülemeler dahil.
- Kişi sayısı sınırı yok.

### İletişim
- Uygulama içi mesajlaşma: her alanın kendi kanalı, her ticket'ın kendi konuşması (ek süre ve geri çekme döngüleri de burada) ve herkesin okuyabildiği, yalnız ana yöneticilerin (ve izin verilenlerin) yazabildiği ortak duyuru kanalı.
- Bildirimler sade olmalı; kişi hangi bildirimleri alacağını seçebilmeli. Sistem yıpratıcı olmamalı.

### Ana yönetici paneli
- Kapsamlı dashboard: tüm alanlar, sprint ilerlemesi, havuzdaki/alınmış/geciken ticket'lar, ek süre ve geri çekme talepleri (cevapsızlar öne çıkar), değerlendirmeler, bekleyen başvurular, roadmap onayları, sprint sonu kararları.
- Alan yönetimi (ekle, düzenle, arşivle, yönetici ata) ve ayarlar (sprint süresi, yönetici cevap süresi, red hakkı sayısı) buradan.
- Her işlem ve her mesaj denetim kaydına düşer; ana yönetici kişi, alan, ticket ve tarihe göre filtreleyip izleyebilir.

## Görsel dil

`referans/kivilcim-alani.html` görsel referanstır (konseptin adı "Kıvılcım Alanı"; tüm konseptler `Vanccha/allspark-ui` private deposunda). Oradaki iş mantığı (sistemin işi kişiye ataması, kapasite/yük hesabı, altı kişilik sabit yerleşim, örnek veri) **alınmaz**; yalnız görsellik alınır:
- Koyu zemin, Saira değişken yazı tipi (geniş `font-stretch` başlıklar), kesik köşeli (clip-path) paneller ve kartlar, üçgen düğümler.
- Sprint haftasına göre tema: 1-7. gün mavi, 8-14. gün kehribar, 15-21. gün kırmızı; başlıktaki gün çubuğu ve lamba (yeşil/sarı/kırmızı). Sprint süresi değişirse tema üç eşit dilime bölünür. Renkler ve CSS değişkenleri referans dosyadan çıkarılıp tasarım token'larına çevrilir.
- Şimşek/kıvılcım efekti yeni akıştaki "ticket iste" anına uyarlanır: kişi kıvılcım çakar, ticket ona düşer.
- Uygulamanın başlığında, wordmark'ın yanında temaya uyan bir **BETA** etiketi bulunur (aktif temanın vurgu rengiyle, aynı kesik köşe diliyle).
- Animasyonlar `prefers-reduced-motion`'a uyar. Mobilde önce telefon düzeni tasarlanır; masaüstü genişletmedir.

## Teknik

- Önerilen yığın (gerekçeli olarak değiştirebilirsin, kararı `docs/KARARLAR.md`'ye yaz): Next.js (App Router, TypeScript, `output: standalone`), PostgreSQL, Drizzle ORM, kullanıcı adı + şifreyi destekleyen olgun bir oturum kütüphanesi, rol bazlı yetki kontrolü her zaman sunucu tarafında.
- Gerçek zamanlı mesaj ve bildirim: tek sunucuda basit kalacak bir yol (ör. PostgreSQL LISTEN/NOTIFY + Server-Sent Events ya da ayrı küçük bir WebSocket servisi). Seçimini gerekçelendir.
- PWA: manifest, service worker, ana ekrana ekleme, Web Push bildirimleri (VAPID). Lokalde `localhost` üzerinde test edilebilir olmalı.
- Dosya yüklemeleri sunucu diskinde (Compose volume); boyut sınırı ayarlanabilir.
- Zamanlanmış işler (72 saat uyarıları, süre dolumu, yönetici cevap süresi) için güvenilir bir zamanlayıcı.
- Veritabanı göçleri, seed (ilk ana yönetici + örnek alanlar), yedekleme betiği.
- README: lokal kurulum (Windows), testleri çalıştırma, Ubuntu sunucuya dağıtım adımları.

## Aşamalar

1. **Temel:** Alt ajan tanımları, git + private GitHub deposu, proje iskeleti, veritabanı şeması, tasarım token'ları, kullanıcı adı/şifre girişi ve roller, başvuru formu → onay akışı, lokalde çalışan kabuk (BETA etiketiyle).
2. **Plan:** Alan yönetimi, sprint, hedef ve roadmap, onay akışı, ticket'lara bölme ve bağımlılık düzenleyicisi.
3. **Ticket döngüsü:** Ticket iste (rastgele, çapraz), red hakkı, 72 saat, ek süre ve geri çekme talepleri, yönetici cevap süresi, teslim, değerlendirme, sprint sonu kararları.
4. **İletişim:** Alan kanalları, ticket konuşmaları, duyuru kanalı, bildirimler ve Web Push.
5. **Ana yönetici paneli:** Dashboard, ayarlar ve denetim kaydı.
6. **Görsel cila:** Kıvılcım Alanı görsel dili, sprint teması, kıvılcım efekti, mobil düzen, PWA kurulumu.

Her aşamada: lokalde çalışan sürüm, yeşil testler, kısa değişiklik özeti, commit ve push. Bir aşama bitince dur, geliştiriciye neyi nasıl deneyeceğini söyle ve onay almadan sonraki aşamaya geçme.

## Açık kararlar

- Alanların ilk adları ve alan yöneticileri: seed'de örnek alanlarla başla; gerçekleri ana yönetici panelden girecek.
- Sprint sonu seçenekleri ileride değişebilir (yukarıda ucu açık bırakıldı).
- Bunların dışında iş kuralında belirsizlik çıkarsa sor.
