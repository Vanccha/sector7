/**
 * Better Auth yapılandırması — SÖZLEŞME.
 * - Giriş yalnız kullanıcı adı + şifre (/api/auth/sign-in/username).
 * - Dışarıdan kayıt kapalı: hesaplar başvuru onayıyla sunucuda açılır (src/server/accounts.ts).
 * - Şifreler argon2id ile saklanır.
 * - Giriş denemelerine IP başına hız sınırı (veritabanında tutulur).
 */
import { betterAuth } from "better-auth";
import { audit } from "@/lib/audit";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { createGithubAccountHooks } from "./github-link";
import { hashPassword, verifyPassword } from "./password";
import { USERNAME_PATTERN } from "@/lib/contracts/applications";

export const SIGN_IN_RATE_LIMIT = { window: 15 * 60, max: 10 } as const;

/**
 * GitHub hesap bağlama (Aşama 7.5): yalnız GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET tanımlıysa etkin.
 * Giriş/kayıt için KULLANILMAZ; yalnız oturumlu kullanıcı POST /link-social ile bağlar (callback: /callback/github).
 * Scope yalnız read:user (varsayılan user:email kapalı); e-posta kullanılmaz/saklanmaz.
 */
const githubSocial =
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          disableDefaultScope: true,
          scope: ["read:user"],
          disableSignUp: true,
          disableImplicitSignUp: true,
        },
      }
    : undefined;

export const auth = betterAuth({
  appName: "AllSpark",
  baseURL: process.env.APP_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
    },
  }),
  advanced: {
    database: { generateId: "uuid" },
    // Üretimde ters vekil (Caddy) X-Forwarded-For başlığını kendisi yazar.
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    password: { hash: hashPassword, verify: ({ hash, password }) => verifyPassword(hash, password) },
  },
  // E-posta ile girişi ve dışarıdan kaydı tamamen kapat; yalnız kullanıcı adıyla giriş açık.
  // GitHub ile giriş/kayıt kapalı: /sign-in/social kapatıldığı için OAuth callback'ine yalnız /link-social state'i ulaşır.
  // /unlink-account yerine kendi unlinkGithub'ımız (user alanlarını da temizler); token uç noktaları kapalı (token saklanmaz).
  disabledPaths: [
    "/sign-up/email",
    "/sign-in/email",
    "/is-username-available",
    "/update-user",
    "/change-email",
    "/sign-in/social",
    "/unlink-account",
    "/get-access-token",
    "/refresh-token",
    "/account-info",
  ],
  ...(githubSocial ? { socialProviders: githubSocial } : {}),
  account: {
    accountLinking: {
      enabled: true,
      // GitHub e-postası farklı olabilir (e-posta zaten alınmıyor); güvenilir sağlayıcı sayılır ama
      // e-posta tabanlı örtük bağlama kapalı: yalnız link-social akışı hesap bağlar.
      allowDifferentEmails: true,
      trustedProviders: ["github"],
      disableImplicitLinking: true,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 gün
    updateAge: 60 * 60 * 24, // her gün yenilenir
  },
  user: {
    additionalFields: {
      phone: { type: "string", required: false, input: false },
      homeAreaId: { type: "string", required: false, input: false },
      isMainAdmin: { type: "boolean", required: false, input: false, defaultValue: false },
      canAnnounce: { type: "boolean", required: false, input: false, defaultValue: false },
      active: { type: "boolean", required: false, input: false, defaultValue: true },
    },
  },
  rateLimit: {
    // Lokal geliştirmede (next dev) kapalı: IP olmadığı için tüm denemeler tek kovaya düşüyor.
    // Testlerde ve üretimde açık.
    enabled: process.env.NODE_ENV !== "development",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/username": SIGN_IN_RATE_LIMIT,
    },
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (u) => USERNAME_PATTERN.test(u),
      // Doğrulama küçük harfe çevrildikten sonra yapılır: "AYSE" ile "ayse" hesabına girilir.
      validationOrder: { username: "post-normalization" },
    }),
    nextCookies(),
  ],
  databaseHooks: {
    account: createGithubAccountHooks(db),
    session: {
      create: {
        // Pasif hesaplar oturum açamaz.
        before: async (s) => {
          const u = await db.query.user.findFirst({
            where: (t, { eq }) => eq(t.id, s.userId),
            columns: { active: true },
          });
          if (!u?.active) return false;
          return { data: s };
        },
        // Denetim kaydı: giriş. Kayıt yazılamazsa giriş bozulmaz (yalnız günlüğe yazılır).
        after: async (s) => {
          await audit(db, {
            actorId: s.userId,
            action: "auth.sign_in",
            entityType: "session",
            subjectUserId: s.userId,
            data: { ip: s.ipAddress ?? null, userAgent: s.userAgent ?? null },
          }).catch((e) => console.error("[denetim] giriş kaydı yazılamadı:", e));
        },
      },
      delete: {
        // Yalnız kullanıcının kendi çıkışı (şifre sıfırlama / pasifleştirmede oturumlar doğrudan silinir).
        after: async (s, ctx) => {
          if (!ctx?.path?.includes("sign-out")) return;
          await audit(db, {
            actorId: s.userId,
            action: "auth.sign_out",
            entityType: "session",
            subjectUserId: s.userId,
          }).catch((e) => console.error("[denetim] çıkış kaydı yazılamadı:", e));
        },
      },
    },
  },
});

export type Auth = typeof auth;
