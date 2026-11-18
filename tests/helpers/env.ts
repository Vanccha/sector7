// Her test dosyasından önce çalışır: uygulama kodu (ör. "@/db", "@/lib/auth/auth")
// yalnız TEST veritabanına bağlanır.
try {
  process.loadEnvFile(".env");
} catch {
  // CI'da ortam değişkenleri doğrudan verilir.
}
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) throw new Error("DATABASE_URL_TEST tanımlı değil (.env).");
process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.APP_URL ??= "http://localhost:3000";
