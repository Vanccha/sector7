/**
 * Hesap işlemleri: kullanıcı açma, tek kullanımlık şifre bağlantıları, ana yönetici.
 * Next.js'e bağımlı değildir; server action'lar ve CLI/seed bu fonksiyonları çağırır.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { account, passwordTokens, session, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { normalizeUsername, passwordSchema, TOKEN_TTL_HOURS, usernameSchema } from "@/lib/contracts/applications";
import { AppError, conflict, invalidState, notFound } from "@/lib/contracts/errors";
import { revokeRememberedDevices } from "./remembered-devices";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function passwordLink(token: string): string {
  return `${appUrl()}/sifre/${token}`;
}

/** Kullanıcı adı ya da e-posta kullanımda mı (hesaplarda). */
export async function findAccountConflicts(db: DbOrTx, usernameRaw: string, email: string) {
  const uname = normalizeUsername(usernameRaw);
  const [byUsername] = await db.select({ id: user.id }).from(user).where(eq(user.username, uname)).limit(1);
  const [byEmail] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase())).limit(1);
  const fields: Record<string, string> = {};
  if (byUsername) fields.username = "Bu kullanıcı adı kullanımda.";
  if (byEmail) fields.email = "Bu e-posta adresiyle açılmış bir hesap var.";
  return fields;
}

/** Şifresiz kullanıcı açar. Şifre tek kullanımlık bağlantıyla belirlenir. */
export async function createUser(
  db: DbOrTx,
  input: {
    name: string;
    username: string;
    email: string;
    phone?: string | null;
    homeAreaId?: string | null;
    isMainAdmin?: boolean;
  },
): Promise<string> {
  const uname = usernameSchema.parse(input.username);
  const conflicts = await findAccountConflicts(db, uname, input.email);
  if (Object.keys(conflicts).length) throw conflict("Kullanıcı adı ya da e-posta kullanımda.", conflicts);
  const [row] = await db
    .insert(user)
    .values({
      name: input.name,
      email: input.email.toLowerCase(),
      emailVerified: false,
      username: uname,
      displayUsername: uname,
      phone: input.phone ?? null,
      homeAreaId: input.homeAreaId ?? null,
      isMainAdmin: input.isMainAdmin ?? false,
    })
    .returning({ id: user.id });
  if (!row) throw new Error("Kullanıcı oluşturulamadı.");
  return row.id;
}

/** Zayıf şifreye yalnız üretim dışında (lokal test) izin verilir. */
export const weakPasswordsAllowed = () => process.env.NODE_ENV !== "production";

/**
 * Kullanıcının şifresini (Better Auth "credential" hesabı) yazar ya da günceller.
 * `allowWeak` yalnız CLI/seed içindir ve üretimde yok sayılır.
 */
export async function setCredentialPassword(
  db: DbOrTx,
  userId: string,
  plainPassword: string,
  opts: { allowWeak?: boolean } = {},
): Promise<void> {
  const weakOk = !!opts.allowWeak && weakPasswordsAllowed() && plainPassword.length > 0;
  const pw = weakOk ? plainPassword : passwordSchema.parse(plainPassword);
  const hashed = await hashPassword(pw);
  const [existing] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);
  if (existing) {
    await db.update(account).set({ password: hashed }).where(eq(account.id, existing.id));
  } else {
    await db.insert(account).values({ userId, accountId: userId, providerId: "credential", password: hashed });
  }
  // Şifre değişince "Beni hatırla" cihazları geçersiz olur.
  await revokeRememberedDevices(db, userId);
}

/** Tek kullanımlık şifre bağlantısı üretir; ham token yalnız bir kez döner, veritabanında özeti saklanır. */
export async function issuePasswordToken(
  db: DbOrTx,
  userId: string,
  purpose: "setup" | "reset",
  createdById: string | null,
  now: Date = new Date(),
): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_HOURS[purpose] * 3_600_000);
  // Aynı kişinin önceki kullanılmamış bağlantıları geçersiz olur.
  await db
    .update(passwordTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordTokens.userId, userId), isNull(passwordTokens.usedAt)));
  await db.insert(passwordTokens).values({ userId, tokenHash: sha256(token), purpose, expiresAt, createdById });
  return { token, url: passwordLink(token), expiresAt };
}

/** Bağlantının hâlâ geçerli olup olmadığını (kullanmadan) kontrol eder. Sayfa gösterimi için. */
export async function inspectPasswordToken(db: DbOrTx, token: string, now: Date = new Date()) {
  const [row] = await db
    .select({
      purpose: passwordTokens.purpose,
      expiresAt: passwordTokens.expiresAt,
      usedAt: passwordTokens.usedAt,
      username: user.username,
      name: user.name,
      active: user.active,
    })
    .from(passwordTokens)
    .innerJoin(user, eq(user.id, passwordTokens.userId))
    .where(eq(passwordTokens.tokenHash, sha256(token)))
    .limit(1);
  if (!row || row.usedAt || row.expiresAt <= now || !row.active) return null;
  return { purpose: row.purpose, username: row.username ?? "", name: row.name };
}

/**
 * Bağlantıyı kullanarak şifreyi belirler. Bağlantı tek kullanımlıktır (satır kilidiyle).
 * Sıfırlamada kişinin açık oturumları kapatılır.
 */
export async function consumePasswordToken(
  db: DB,
  token: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<{ userId: string; username: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(passwordTokens)
      .where(eq(passwordTokens.tokenHash, sha256(token)))
      .for("update")
      .limit(1);
    if (!row || row.usedAt || row.expiresAt <= now) {
      throw invalidState("Bu bağlantı geçersiz ya da süresi dolmuş. Ana yöneticiden yeni bir bağlantı iste.");
    }
    const [u] = await tx
      .select({ id: user.id, username: user.username, active: user.active })
      .from(user)
      .where(eq(user.id, row.userId))
      .limit(1);
    if (!u || !u.active) throw invalidState("Bu hesap etkin değil.");

    await setCredentialPassword(tx, u.id, newPassword);
    await tx.update(passwordTokens).set({ usedAt: now }).where(eq(passwordTokens.id, row.id));
    if (row.purpose === "reset") await tx.delete(session).where(eq(session.userId, u.id));
    await audit(tx, {
      actorId: u.id,
      action: "auth.password_set",
      entityType: "user",
      entityId: u.id,
      subjectUserId: u.id,
      data: { purpose: row.purpose },
    });
    return { userId: u.id, username: u.username ?? "" };
  });
}

/** Ana yönetici, bir kişi için şifre sıfırlama bağlantısı üretir. */
export async function issueResetLink(db: DB, actor: Actor | null, userId: string) {
  const a = requireMainAdmin(actor);
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
    if (!u) throw notFound("Kişi bulunamadı.");
    const link = await issuePasswordToken(tx, userId, "reset", a.id);
    await revokeRememberedDevices(tx, userId);
    await audit(tx, {
      actorId: a.id,
      action: "user.reset_link_issued",
      entityType: "user",
      entityId: userId,
      subjectUserId: userId,
    });
    return link;
  });
}

/**
 * İlk ana yöneticiyi oluşturur (yalnız seed/CLI). Arayüzde karşılığı yoktur.
 * Kullanıcı adı zaten varsa o kişiyi ana yönetici yapar ve şifresini günceller.
 */
export async function createMainAdminAccount(
  db: DB,
  input: { username: string; name: string; email: string; password: string; allowWeak?: boolean },
): Promise<{ userId: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const uname = usernameSchema.parse(input.username);
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.username, uname)).limit(1);
    let userId: string;
    let created = false;
    if (existing) {
      userId = existing.id;
      await tx.update(user).set({ isMainAdmin: true, active: true }).where(eq(user.id, userId));
    } else {
      userId = await createUser(tx, { name: input.name, username: uname, email: input.email, isMainAdmin: true });
      created = true;
    }
    await setCredentialPassword(tx, userId, input.password, { allowWeak: input.allowWeak });
    await audit(tx, {
      actorId: null,
      action: "user.create_main_admin",
      entityType: "user",
      entityId: userId,
      subjectUserId: userId,
      data: { via: "cli", created },
    });
    return { userId, created };
  });
}

/** Arayüzden ana yönetici yetkisi: yalnız mevcut ana yönetici verebilir/geri alabilir. */
export async function setMainAdmin(db: DB, actor: Actor | null, userId: string, value: boolean): Promise<void> {
  const a = requireMainAdmin(actor);
  if (!value && userId === a.id) throw new AppError("INVALID_STATE", "Kendi ana yönetici yetkini kaldıramazsın.");
  await db.transaction(async (tx) => {
    const res = await tx.update(user).set({ isMainAdmin: value }).where(eq(user.id, userId)).returning({ id: user.id });
    if (!res.length) throw notFound("Kişi bulunamadı.");
    await audit(tx, {
      actorId: a.id,
      action: value ? "user.grant_main_admin" : "user.revoke_main_admin",
      entityType: "user",
      entityId: userId,
      subjectUserId: userId,
    });
  });
}
