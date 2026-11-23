/**
 * "Beni hatırla" cihazları. Next.js'e bağımlı değildir.
 * - Tarayıcıda yalnız rastgele bir cihaz token'ı (httpOnly çerez) durur; şifre istemcide hiç saklanmaz.
 * - Veritabanında token'ın yalnız SHA-256 özeti tutulur; arama özet üzerinden yapılır (zamanlama sızıntısı yok).
 * - Her başarılı kullanımda token yenilenir (aynı satır) ve süre kayar; eski token bir daha çalışmaz.
 *   Tek istisna iki sekme yarışı: bir önceki token yenilemeden sonraki ROTATION_GRACE_SECONDS içinde
 *   bir kez kabul edilir (çerez yeniden yazılmaz). Pencere dışındaki eski token reddedilir.
 * - Pasif kişi bu yolla da giriş yapamaz. Şifre değişince / sıfırlama bağlantısı üretilince / pasifleştirmede silinir.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { rememberedDevices, user } from "@/db/schema";

export const REMEMBER_COOKIE = "s7_remember";
export const REMEMBER_TTL_DAYS = 60;
export const REMEMBER_TTL_SECONDS = REMEMBER_TTL_DAYS * 24 * 60 * 60;
export const ROTATION_GRACE_SECONDS = 30;
const PURGE_BATCH = 100;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newDeviceToken = () => randomBytes(32).toString("base64url");
export const hashDeviceToken = (token: string) => createHash("sha256").update(token).digest("hex");
/** Biçimi bozuk değerler veritabanına hiç gitmez. */
export const isWellFormedDeviceToken = (token: unknown): token is string =>
  typeof token === "string" && TOKEN_PATTERN.test(token);

const expiryFrom = (now: Date) => new Date(now.getTime() + REMEMBER_TTL_SECONDS * 1000);
const shortUa = (ua: string | null | undefined) => (ua ? ua.slice(0, 200) : null);

/** Yeni hatırlanan cihaz kaydı açar; ham token yalnız burada bir kez döner. */
export async function createRememberedDevice(
  db: DbOrTx,
  userId: string,
  opts: { userAgent?: string | null; now?: Date } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const now = opts.now ?? new Date();
  await purgeExpiredRememberedDevices(db, now);
  const token = newDeviceToken();
  const expiresAt = expiryFrom(now);
  await db.insert(rememberedDevices).values({
    userId,
    tokenHash: hashDeviceToken(token),
    createdAt: now,
    expiresAt,
    userAgent: shortUa(opts.userAgent),
  });
  return { token, expiresAt };
}

/** Giriş ekranında gösterilecek hesap (yalnız ad + kullanıcı adı). Geçersizse null. */
export async function peekRememberedDevice(
  db: DbOrTx,
  token: unknown,
  now: Date = new Date(),
): Promise<{ name: string; username: string } | null> {
  if (!isWellFormedDeviceToken(token)) return null;
  const [row] = await db
    .select({ name: user.name, username: user.username })
    .from(rememberedDevices)
    .innerJoin(user, eq(user.id, rememberedDevices.userId))
    .where(
      and(
        eq(rememberedDevices.tokenHash, hashDeviceToken(token)),
        gt(rememberedDevices.expiresAt, now),
        eq(user.active, true),
      ),
    )
    .limit(1);
  if (!row?.username) return null;
  return { name: row.name, username: row.username };
}

/**
 * Token'ı kullanır: geçerliyse aynı satırda yeni token üretir, süreyi kaydırır ve yeni ham token'ı döner.
 * İki sekme yarışını kaybeden istek (bir önceki token, pencere içinde, bir kez) oturum alır ama
 * `token: null` döner: çerez yeniden yazılmaz ve kazananın yeni token'ı bozulmaz.
 * Geçersiz / süresi dolmuş / pasif kişi / pencere dışı eski token'da null (nedeni ayırt edilmez).
 */
export async function consumeRememberedDevice(
  db: DB,
  token: unknown,
  opts: { userAgent?: string | null; now?: Date } = {},
): Promise<{ userId: string; token: string | null; expiresAt: Date } | null> {
  if (!isWellFormedDeviceToken(token)) return null;
  const now = opts.now ?? new Date();
  const hash = hashDeviceToken(token);
  const cols = {
    id: rememberedDevices.id,
    userId: rememberedDevices.userId,
    expiresAt: rememberedDevices.expiresAt,
    rotatedAt: rememberedDevices.rotatedAt,
  };
  return db.transaction(async (tx) => {
    const isUsable = async (row: { id: string; userId: string; expiresAt: Date }) => {
      if (row.expiresAt > now) {
        const [u] = await tx.select({ active: user.active }).from(user).where(eq(user.id, row.userId)).limit(1);
        if (u?.active) return true;
      }
      await tx.delete(rememberedDevices).where(eq(rememberedDevices.id, row.id));
      return false;
    };

    // Satır kilidi: eşzamanlı ikinci istek ilki bitene kadar bekler, sonra token_hash artık eşleşmez.
    const [row] = await tx.select(cols).from(rememberedDevices).where(eq(rememberedDevices.tokenHash, hash)).for("update").limit(1);
    if (row) {
      if (!(await isUsable(row))) return null;
      const next = newDeviceToken();
      const expiresAt = expiryFrom(now);
      await tx
        .update(rememberedDevices)
        .set({
          tokenHash: hashDeviceToken(next),
          previousTokenHash: hash,
          rotatedAt: now,
          lastUsedAt: now,
          expiresAt,
          ...(opts.userAgent ? { userAgent: shortUa(opts.userAgent) } : {}),
        })
        .where(eq(rememberedDevices.id, row.id));
      return { userId: row.userId, token: next, expiresAt };
    }

    const [prev] = await tx
      .select(cols)
      .from(rememberedDevices)
      .where(eq(rememberedDevices.previousTokenHash, hash))
      .for("update")
      .limit(1);
    if (!prev?.rotatedAt) return null;
    const inGrace = now.getTime() - prev.rotatedAt.getTime() <= ROTATION_GRACE_SECONDS * 1000;
    if (!inGrace || !(await isUsable(prev))) return null;
    // Bir kez: aynı eski token ikinci kez kabul edilmez.
    await tx
      .update(rememberedDevices)
      .set({ previousTokenHash: null, lastUsedAt: now })
      .where(eq(rememberedDevices.id, prev.id));
    return { userId: prev.userId, token: null, expiresAt: prev.expiresAt };
  });
}

/** "Başka bir hesapla giriş yap": bu cihazın kaydını siler. */
export async function forgetRememberedDevice(db: DbOrTx, token: unknown): Promise<void> {
  if (!isWellFormedDeviceToken(token)) return;
  await db.delete(rememberedDevices).where(eq(rememberedDevices.tokenHash, hashDeviceToken(token)));
}

/** Kişinin tüm hatırlanan cihazlarını siler (şifre değişimi, sıfırlama bağlantısı, pasifleştirme). */
export async function revokeRememberedDevices(db: DbOrTx, userId: string): Promise<void> {
  await db.delete(rememberedDevices).where(eq(rememberedDevices.userId, userId));
}

/** Süresi dolmuş kayıtları sınırlı sayıda siler (yeni cihaz açılırken fırsatçı temizlik). */
export async function purgeExpiredRememberedDevices(db: DbOrTx, now: Date = new Date()): Promise<void> {
  const stale = db
    .select({ id: rememberedDevices.id })
    .from(rememberedDevices)
    .where(lte(rememberedDevices.expiresAt, now))
    .limit(PURGE_BATCH);
  await db.delete(rememberedDevices).where(inArray(rememberedDevices.id, stale));
}
