/**
 * Better Auth yapılandırması — SÖZLEŞME.
 * - Giriş yalnız kullanıcı adı + şifre (/api/auth/sign-in/username).
 * - Dışarıdan kayıt kapalı: hesaplar başvuru onayıyla sunucuda açılır (src/server/accounts.ts).
 * - Şifreler argon2id ile saklanır.
 * - Giriş denemelerine IP başına hız sınırı (veritabanında tutulur).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";
import { USERNAME_PATTERN } from "@/lib/contracts/applications";

export const SIGN_IN_RATE_LIMIT = { window: 15 * 60, max: 10 } as const;

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
  disabledPaths: ["/sign-up/email", "/sign-in/email", "/is-username-available", "/update-user", "/change-email"],
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
    enabled: true,
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
    }),
    nextCookies(),
  ],
  databaseHooks: {
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
      },
    },
  },
});

export type Auth = typeof auth;
