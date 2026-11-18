/**
 * GitHub entegrasyonu (Aşama 7.5) — SÖZLEŞME. Tasarım: docs/GITHUB-TASARIM.md.
 * Adım 1 (onaylı): kullanıcı adı + şifre girişi aynen kalır; profilde "GitHub hesabını bağla" (OAuth).
 *  - Bağlantı yalnız mevcut oturumlu kullanıcıya eklenir; GitHub ile kayıt/giriş YOK (dışarıdan kayıt kapalı).
 *  - OAuth token'ları saklanmaz: bağlanırken GitHub kimliği (id) ve adı (login) okunur, user tablosuna yazılır,
 *    token'lar atılır. Bir GitHub hesabı tek SECTOR7 hesabına bağlanabilir (user.github_id benzersiz).
 *  - Başvuru formunda GitHub kullanıcı adı isteğe bağlı ve doğrulanmamış bilgi olarak saklanır.
 *  - Entegrasyon açıksa (GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET tanımlı) ticket kabulü için bağlı hesap zorunlu
 *    ("ilk ticket kabulünde bağlama zorunlu"). Kapalıysa hiçbir kural değişmez.
 * Adım 2-4 (geliştirici onayı 2026-11-18): GitHub App; alan başına depo (org içinde), sprint = milestone +
 * `sprint-NN` etiketi; ticket yayınlanınca issue; kabulde iş dalı + issue ataması (yalnız gösterge — iş
 * dağıtımı SECTOR7'de, çekme modeli değişmez); PR/issue durumu webhook ile geri gelir; teslim = ticket'ın PR'ı
 * (SECTOR7 teslim formunda seçilir), teslim ve değerlendirme SECTOR7'de kalır; GitHub'da PR birleşmesi ya da
 * issue kapanması ticket'ı TESLİM ETMEZ (yalnız "teslime hazır" ipucu). Sunucu diskine yükleme geçişte açık,
 * `uploadsEnabled` ayarıyla kapanır.
 */
import { z } from "zod";

/** GitHub kullanıcı adı kuralı: 1-39 karakter, harf/rakam/tire, tireyle başlayıp bitmez, art arda tire yok. */
export const GITHUB_USERNAME_RE = /^(?!-)(?!.*--)[a-zA-Z0-9-]{1,39}(?<!-)$/;

export const githubUsernameSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, ""))
  .refine((v) => v === "" || GITHUB_USERNAME_RE.test(v), "Geçerli bir GitHub kullanıcı adı yaz.")
  .transform((v) => (v === "" ? null : v));

export type GithubLink = { login: string; linkedAt: string } | null;

/** Better Auth sağlayıcı kimliği. */
export const GITHUB_PROVIDER_ID = "github";

export const GITHUB_REQUIRED_MESSAGE =
  "Ticket kabul etmeden önce GitHub hesabını bağlaman gerekiyor (Profil → GitHub hesabını bağla).";

/* ------------------------------------------------------------------ */
/* Adım 2-4: GitHub App senkronu                                       */
/* ------------------------------------------------------------------ */

/**
 * Ortam değişkenleri (hepsi tanımlıysa senkron açık):
 *  GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY (PEM; "\n" kaçışları kabul) ya da GITHUB_APP_PRIVATE_KEY_PATH,
 *  GITHUB_APP_INSTALLATION_ID, GITHUB_ORG, GITHUB_WEBHOOK_SECRET.
 * Hesap bağlama (adım 1) GITHUB_CLIENT_ID/SECRET ile ayrıdır (App'in kendi OAuth bilgileri de kullanılabilir).
 */
export const GITHUB_APP_ENV = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_ORG",
  "GITHUB_WEBHOOK_SECRET",
] as const;

/** Depo adı kuralı (org içindeki ad): harf/rakam/-/_/. , en fazla 100. */
export const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
export const githubRepoSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || (GITHUB_REPO_RE.test(v) && v !== "." && v !== ".."), "Geçerli bir depo adı yaz.")
  .transform((v) => (v === "" ? null : v));
export const setAreaRepoSchema = z.object({ areaId: z.string().uuid(), repo: githubRepoSchema });

/** Sprint etiketi ve milestone başlığı. */
export const sprintLabel = (sprintNumber: number) => `sprint-${String(sprintNumber).padStart(2, "0")}`;
export const sprintMilestoneTitle = (sprintNumber: number) => `Sprint ${sprintNumber}`;

/** Ticket kısa kimliği (dal ve klasör adlarında). */
export const ticketShortId = (ticketId: string) => ticketId.replace(/-/g, "").slice(0, 8);

/** Türkçe karakterleri sadeleştirip dal/klasör için slug (en fazla 40). */
export function slugify(title: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u" };
  const s = title
    .replace(/[çğıİöşü]/gi, (c) => map[c] ?? map[c.toLowerCase()] ?? c)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "is";
}

/** İş dalı ve klasörü: `sprint-07/ab12cd34-ana-sayfa-hero`. */
export const ticketBranch = (sprintNumber: number, ticketId: string, title: string) =>
  `${sprintLabel(sprintNumber)}/${ticketShortId(ticketId)}-${slugify(title)}`;

/** Dal adından ticket kısa kimliği (PR eşleme). Eşleşmezse null. */
export function shortIdFromBranch(branch: string): string | null {
  const m = /^sprint-\d{2,}\/([0-9a-f]{8})(?:-|$)/.exec(branch);
  return m ? m[1]! : null;
}

/** Ticket sayfasında gösterilen GitHub bilgisi (herkese açık olmayan; ticket'ı görebilen görür). */
export type TicketGithubView = {
  repo: string | null;
  issueUrl: string | null;
  branch: string | null;
  branchUrl: string | null;
  pullRequests: { id: string; number: number; url: string; title: string; state: "open" | "closed"; merged: boolean }[];
  /** En az bir PR birleşti — "teslime hazır" ipucu (ticket'ı otomatik teslim ETMEZ). */
  readyToSubmit: boolean;
  /** Senkron kuyruğunda bekleyen/başarısız iş var mı (yalnız alan yöneticisi/ana yöneticiye gösterilir). */
  syncPending: boolean;
  syncError: string | null;
};
