/** Başvuru ve hesap girdileri — SÖZLEŞME. İstemci ve sunucu aynı şemayı kullanır. */
import { z } from "zod";

/** Better Auth username eklentisiyle uyumlu: küçük harf, rakam, alt çizgi, nokta. */
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .regex(USERNAME_PATTERN, "Kullanıcı adı 3-30 karakter olmalı; yalnız küçük harf, rakam, _ ve . kullanılabilir."),
  );

export const passwordSchema = z
  .string()
  .min(10, "Şifre en az 10 karakter olmalı.")
  .max(128, "Şifre en fazla 128 karakter olabilir.");

export const applicationInputSchema = z.object({
  fullName: z.string().trim().min(3, "Ad soyad en az 3 karakter olmalı.").max(100),
  username: usernameSchema,
  email: z.string().trim().toLowerCase().pipe(z.email("Geçerli bir e-posta adresi yaz.")),
  phone: z
    .string()
    .trim()
    .transform((p) => p.replace(/[\s()-]/g, ""))
    .pipe(z.string().regex(/^\+?[0-9]{10,15}$/, "Geçerli bir telefon numarası yaz (ör. 05xx xxx xx xx).")),
  intro: z.string().trim().min(20, "Kendini birkaç cümleyle tanıt (en az 20 karakter).").max(2000),
});
export type ApplicationInput = z.input<typeof applicationInputSchema>;

export const approveApplicationSchema = z.object({
  applicationId: z.uuid(),
  homeAreaId: z.uuid({ error: "Ana alan seç." }),
});

export const rejectApplicationSchema = z.object({
  applicationId: z.uuid(),
  note: z.string().trim().max(1000).optional(),
});

export const setPasswordSchema = z
  .object({
    token: z.string().min(20),
    password: passwordSchema,
    passwordRepeat: z.string(),
  })
  .refine((v) => v.password === v.passwordRepeat, {
    message: "Şifreler aynı değil.",
    path: ["passwordRepeat"],
  });

/** Tek kullanımlık bağlantıların geçerlilik süreleri (saat). */
export const TOKEN_TTL_HOURS = { setup: 24 * 7, reset: 24 } as const;
