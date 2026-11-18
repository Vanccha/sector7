/**
 * GitHub entegrasyonu (Aşama 7.5) — SÖZLEŞME. Tasarım: docs/GITHUB-TASARIM.md.
 * Adım 1 (onaylı): kullanıcı adı + şifre girişi aynen kalır; profilde "GitHub hesabını bağla" (OAuth).
 *  - Bağlantı yalnız mevcut oturumlu kullanıcıya eklenir; GitHub ile kayıt/giriş YOK (dışarıdan kayıt kapalı).
 *  - OAuth token'ları saklanmaz: bağlanırken GitHub kimliği (id) ve adı (login) okunur, user tablosuna yazılır,
 *    token'lar atılır. Bir GitHub hesabı tek SECTOR7 hesabına bağlanabilir (user.github_id benzersiz).
 *  - Başvuru formunda GitHub kullanıcı adı isteğe bağlı ve doğrulanmamış bilgi olarak saklanır.
 *  - Entegrasyon açıksa (GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET tanımlı) ticket kabulü için bağlı hesap zorunlu
 *    ("ilk ticket kabulünde bağlama zorunlu"). Kapalıysa hiçbir kural değişmez.
 * Adım 2+ (GitHub App, issue senkronu, PR ile teslim) teslim/senkron kararı verilince.
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
