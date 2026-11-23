/**
 * "Beni hatırla" — Better Auth eklentisi (iş mantığı: src/server/remembered-devices.ts).
 * - /sign-in/username başarılıysa ve istemci `x-remember-device: 1` gönderdiyse cihaz token'ı üretilip
 *   httpOnly çereze yazılır. Tik atılmadan yapılan girişte bu tarayıcıdaki eski kayıt silinir.
 * - POST /remembered-device/sign-in: çerezdeki token doğrulanır, yenilenir ve normal bir Better Auth
 *   oturumu açılır (aynı oturum süresi/çerezi, pasif kişi kancası ve denetim kaydı). Giriş hız sınırı uygulanır
 *   (HTTP uç noktası olduğu için; bkz. auth.ts customRules).
 * - POST /remembered-device/forget: bu cihazın kaydını siler, çerezi temizler.
 * Başarısız durumların hepsi aynı nötr yanıtı verir ({ ok: false }); çerez yalnız istekte varsa temizlenir.
 * Her iki uç nokta da kaynak (Origin / Sec-Fetch-Site) denetler: siteler arası POST çerezi silemez.
 */
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, isAPIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { DB } from "@/db";
import { audit } from "@/lib/audit";
import {
  REMEMBER_COOKIE,
  REMEMBER_TTL_SECONDS,
  consumeRememberedDevice,
  createRememberedDevice,
  forgetRememberedDevice,
  revokeRememberedDevices,
} from "@/server/remembered-devices";

export const REMEMBER_HEADER = "x-remember-device";
export const REMEMBERED_SIGN_IN_PATH = "/remembered-device/sign-in";

const secureCookie = () => (process.env.APP_URL ?? "").startsWith("https://");
const cookieAttrs = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: secureCookie(),
  path: "/",
  maxAge,
});

type CookieCtx = {
  setCookie: (key: string, value: string, options?: ReturnType<typeof cookieAttrs>) => string;
};
const writeRememberCookie = (ctx: CookieCtx, token: string) =>
  ctx.setCookie(REMEMBER_COOKIE, token, cookieAttrs(REMEMBER_TTL_SECONDS));
const clearRememberCookie = (ctx: CookieCtx) => ctx.setCookie(REMEMBER_COOKIE, "", cookieAttrs(0));

/** Şifre değiştiren oturumlu Better Auth uç noktaları (arayüzde kullanılmıyor; yine de cihazlar düşürülür). */
const PASSWORD_PATHS = new Set(["/change-password", "/set-password"]);

type OriginCtx = {
  headers?: Headers;
  request?: Request;
  context: { isTrustedOrigin: (url: string) => boolean };
};
/**
 * Better Auth'un kaynak denetimi yalnız istekte çerez varken çalışır; SameSite=Lax çerez siteler arası
 * POST'ta gönderilmediği için burada her zaman denetlenir. Origin varsa güvenilir olmalı; yoksa
 * tarayıcının Sec-Fetch-Site başlığı same-origin olmalı. İkisi de yoksa reddedilir.
 */
function assertSameOrigin(ctx: OriginCtx) {
  const origin = ctx.headers?.get("origin");
  const site = ctx.headers?.get("sec-fetch-site");
  const requestOrigin = ctx.request ? new URL(ctx.request.url).origin : null;
  const ok =
    origin && origin !== "null"
      ? origin === requestOrigin || ctx.context.isTrustedOrigin(origin)
      : site === "same-origin";
  if (!ok) throw new APIError("FORBIDDEN", { message: "Geçersiz istek kaynağı." });
}

export const rememberedDevice = (db: DB) =>
  ({
    id: "remembered-device",
    endpoints: {
      rememberedDeviceSignIn: createAuthEndpoint(REMEMBERED_SIGN_IN_PATH, { method: "POST" }, async (ctx) => {
        assertSameOrigin(ctx);
        const cookie = ctx.getCookie(REMEMBER_COOKIE);
        const fail = () => {
          if (cookie !== null) clearRememberCookie(ctx);
          return ctx.json({ ok: false as const });
        };
        if (!cookie) return fail();
        const userAgent = ctx.headers?.get("user-agent") ?? null;
        const used = await consumeRememberedDevice(db, cookie, { userAgent });
        if (!used) return fail();
        const user = await ctx.context.internalAdapter.findUserById(used.userId);
        if (!user) return fail();
        // databaseHooks.session.create: pasif kişi kancası + auth.sign_in denetim kaydı burada da çalışır.
        const session = await ctx.context.internalAdapter.createSession(used.userId).catch(() => null);
        if (!session) return fail();
        await setSessionCookie(ctx, { session, user });
        // Yarışı kaybeden istek (token: null) çereze dokunmaz; kazananın yeni token'ı kalır.
        if (used.token) writeRememberCookie(ctx, used.token);
        await audit(db, {
          actorId: used.userId,
          action: "auth.remembered_sign_in",
          entityType: "session",
          subjectUserId: used.userId,
          data: { userAgent },
        }).catch((e) => console.error("[denetim] hatırlanan cihaz girişi yazılamadı:", e));
        return ctx.json({ ok: true as const });
      }),
      rememberedDeviceForget: createAuthEndpoint("/remembered-device/forget", { method: "POST" }, async (ctx) => {
        assertSameOrigin(ctx);
        const cookie = ctx.getCookie(REMEMBER_COOKIE);
        if (cookie !== null) {
          await forgetRememberedDevice(db, cookie);
          clearRememberCookie(ctx);
        }
        return ctx.json({ ok: true as const });
      }),
    },
    hooks: {
      after: [
        {
          matcher: (c) => c.path === "/sign-in/username",
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (!created) return;
            const existing = ctx.getCookie(REMEMBER_COOKIE);
            if (existing) await forgetRememberedDevice(db, existing);
            if (ctx.headers?.get(REMEMBER_HEADER) === "1") {
              const { token } = await createRememberedDevice(db, created.user.id, {
                userAgent: ctx.headers?.get("user-agent") ?? null,
              });
              writeRememberCookie(ctx, token);
            } else if (existing) {
              clearRememberCookie(ctx);
            }
          }),
        },
        {
          matcher: (c) => PASSWORD_PATHS.has(c.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            if (isAPIError(ctx.context.returned)) return;
            const userId = ctx.context.session?.user.id;
            if (userId) await revokeRememberedDevices(db, userId);
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
