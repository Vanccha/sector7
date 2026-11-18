# Aşama 7: geliştirici geri bildirimi (2026-11-18)

Önce `PROMPT.md`'yi (iş kuralları, çalışma stratejisi, görsel dil) ve `docs/KARARLAR.md`'yi oku. Çalışma usulü aynı: oturumu sen (Opus) yönetirsin, kodu `.claude/agents/` altındaki Sonnet alt ajanlarına (`builder`, `ui-builder`, `test-writer`) dosya sınırları belli dilimler hâlinde dağıtırsın, kalite kapısı sende. Aynı dosyaya iki ajan yazmaz. Kararlarını `docs/KARARLAR.md`'ye yaz.

Altı aşama bitti, bu aşama geliştiricinin uygulamayı denedikten sonraki istekleri. **Önce mevcut kodu incele** (Explore ajanı); zaten var olanı yeniden yazma, yalnız eksik olanı tamamla.

## Ortam notu

- Geliştirme artık **macOS**'ta da yapılıyor (Mac mini). Docker Desktop açık, `sector7-db-1` konteyneri çalışıyor, göçler ve seed uygulanmış.
- `npm run dev` arka planda zaten çalışıyor olabilir (port 3000). Yeniden başlatman gerekirse önce mevcut süreci bul.
- Lokal deneme hesapları (şifreleri `1`): `admin` (ana yönetici), `yonetici` (Tasarım alanının yöneticisi), `uye` (Yazılım alanında üye). Geliştirici bunları kullanıyor; silme, şifrelerini değiştirme.
- Bağımlılık eklersen `docs/KARARLAR.md`'deki package-lock notunu uygula (kilit Linux'ta üretilir, `@emnapi/*` kayıtları düşmemeli).

## İstekler (geliştiricinin sözleri özetlenerek)

### 7.1 PWA kurulum düğmesi
Uygulamayı ana ekrana eklemek için görünür bir "Uygulamayı yükle" düğmesi. Chrome/Android'de `beforeinstallprompt` ile gerçek kurulum; iOS Safari'de (otomatik istem yok) kısa "Paylaş → Ana Ekrana Ekle" yönergesi. Uygulama zaten kuruluysa (`display-mode: standalone`) düğme görünmez. Kıvılcım Alanı görsel diline uysun.

### 7.2 Masaüstü yerleşimi
Web (masaüstü) görünümünde sistem çok sola yaslı. İçerik ortalansın ve geniş ekranın boşluğu kullanılabilir şekilde, homojen yerleşsin (ör. ortalanmış en geniş kap + uygun sayfalarda çok sütunlu ızgara). Mobil düzen bozulmasın; mobil önce kuralı geçerli.

### 7.3 Şema: canlı çalışma haritası (ana görünüm)
Herkesin görebildiği bir ana görünüm: kim **şu an hangi alandan ticket almış, üzerinde çalışıyor**, anlık olarak görselleştirilsin. Görsel dil konsept arayüzlerdeki şema stili: `referans/kivilcim-alani.html` içindeki düğüm/bağlantı düzeni (alanlar ve kişiler düğüm, aktif ticket'lar bağlantı). Canlılık mevcut gerçek zamanlı altyapıyla (`/api/olaylar`) sağlanır.
- Konseptteki iş mantığı (atama, kapasite/yük hesabı, altı kişilik sabit yerleşim) yine **alınmaz**. Düğüm sayısı değişken; yerleşim alan ve kişi sayısına göre ölçeklenir. Mobilde okunabilir bir karşılığı olmalı (ör. liste/sütun görünümü).
- Telefon ve e-posta gibi kişisel veri bu görünümde yok; ad, alan ve ticket başlığı yeterli.
- **Açık karar: düğüm şekli.** Geliştirici "üçgenler değiştirilebilir, üzerine düşünelim" dedi. Düğümü şekli kolay değişen tek bir bileşen olarak kur. Uygulamadan önce 2–3 şekil alternatifi (gerekçesiyle, mümkünse küçük görsel önizlemeyle) sun ve geliştiricinin seçmesini bekle.

### 7.4 Roadmap ve ticket bağımlılık düzenleyicisinin geliştirilmesi
Roadmap'te ticket maddeleri etkileşimli olarak sürüklenip yer değiştirebilsin. Her ilişki için seçilebilsin: bu iş **paralel** gidebilir mi, yoksa başka bir işe **şartlı/sıralı** mı (önce o bitmeli). Sistem bunu otomatik işletsin: ön koşulu bitmemiş iş havuza çıkmaz; ön koşulu bitince kendiliğinden alınabilir olur; o alanda diğer işler ilerlemeden yapılabilecek durumdaki işler beklemeden havuza çıkar, böylece başka biri onları alabilir.
- Bağımlılık DAG'ı, React Flow düzenleyicisi ve "alınabilir" koşulu Aşama 2'de kuruldu. Önce neyin var olduğunu çıkar, yalnız eksikleri ekle (sürükle-bırak sıralama, ilişki türü seçimi, otomatik havuza çıkışın görünür olması, mobil karşılık).
- Çekme modeli değişmez: sistem kimseye iş **atamaz**. "Başkasına paslama" ifadesini havuz üzerinden başkasının alabilmesi olarak yorumla. Doğrudan kişiye yönlendirme gerektiğini düşünürsen uygulamadan önce sor.
- Döngü engeli, eşzamanlılık ve yetki kuralları için `test-writer`'ı çalıştır.

### 7.5 GitHub entegrasyonu (önce tasarım, onaydan sonra kod)
Geliştiricinin isteği: hesaplar kayıt olurken GitHub ile bağlansın, sistem GitHub ile senkron çalışsın. Kod olmayan projeler (tasarım, içerik vb.) bile GitHub üzerinden dönsün ve GitHub kaynak olarak kullanılsın; böylece teslim dosyaları sunucuda birikip yük oluşturmaz.

Bu büyük ve belirsiz bir iş. **Kod yazmadan önce** kısa bir tasarım önerisi hazırla (`docs/GITHUB-TASARIM.md`) ve geliştiriciye şu kararları sor:
- Kimlik: GitHub OAuth ile giriş mi, yoksa mevcut kullanıcı adı + şifre girişine ek olarak "GitHub hesabını bağla" mı? Başvuru formunda GitHub hesabı zorunlu mu?
- Yapı: AllSpark için bir GitHub organizasyonu var mı/açılacak mı? Depo düzeni: alan başına mı, sprint başına mı, ticket başına mı?
- Teslim: teslim dosyaları GitHub'a (commit, Release asset ya da LFS) mı gidecek; mevcut sunucu diskindeki yükleme ne olacak?
- Senkron yönü: hangi bilgi GitHub'dan sisteme akar (commit, PR, issue durumu), hangisi sistemden GitHub'a (ticket → issue)?
- GitHub App mi, OAuth App mi; token/sır yönetimi ve kapsamlar.

Onay gelmeden 7.5 için kod yazma.

## Sıra ve teslim

Önerilen sıra: 7.1 + 7.2 (küçük, birlikte) → 7.3 → 7.4 → 7.5. 7.3 ve 7.5'teki soruları erkenden sor ki cevaplar beklenirken diğer işlere geçilebilsin.

Her alt aşamada: lokalde çalışan sürüm, `tsc --noEmit` + lint + testler yeşil, kısa değişiklik özeti, commit ve `main`'e push. Her alt aşama bitince dur, geliştiriciye neyi hangi hesapla nasıl deneyeceğini söyle ve onay almadan sonrakine geçme.
