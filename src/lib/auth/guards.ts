/**
 * Yetki kontrolleri — SÖZLEŞME. Saf fonksiyonlar; Next.js'e bağımlı değildir, testlerde doğrudan kullanılır.
 * Her server action / route handler önce `getActor()` (session.ts), sonra buradaki kontrollerle başlar.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { areas, user } from "@/db/schema";
import type { Actor } from "@/lib/contracts/actor";
import { forbidden, unauthenticated } from "@/lib/contracts/errors";

/** Veritabanından aktörü (rolleriyle) yükler. Pasif ya da bulunamayan kullanıcıda null. */
export async function loadActor(db: DbOrTx, userId: string): Promise<Actor | null> {
  const [u] = await db
    .select({
      id: user.id,
      username: user.username,
      name: user.name,
      isMainAdmin: user.isMainAdmin,
      canAnnounce: user.canAnnounce,
      homeAreaId: user.homeAreaId,
      active: user.active,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!u || !u.active) return null;
  const managed = await db
    .select({ id: areas.id })
    .from(areas)
    .where(and(eq(areas.managerId, userId), isNull(areas.archivedAt)));
  return {
    id: u.id,
    username: u.username ?? "",
    name: u.name,
    isMainAdmin: u.isMainAdmin,
    canAnnounce: u.canAnnounce,
    homeAreaId: u.homeAreaId,
    managedAreaIds: managed.map((m) => m.id),
  };
}

export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw unauthenticated();
  return actor;
}

export function isMainAdmin(actor: Actor | null): boolean {
  return !!actor?.isMainAdmin;
}

export function requireMainAdmin(actor: Actor | null): Actor {
  const a = requireActor(actor);
  if (!a.isMainAdmin) throw forbidden("Bu işlem yalnız ana yöneticilere açık.");
  return a;
}

/** Alanı yönetebilir mi: o alanın yöneticisi ya da ana yönetici. */
export function canManageArea(actor: Actor | null, areaId: string): boolean {
  if (!actor) return false;
  return actor.isMainAdmin || actor.managedAreaIds.includes(areaId);
}

export function requireAreaManager(actor: Actor | null, areaId: string): Actor {
  const a = requireActor(actor);
  if (!canManageArea(a, areaId)) throw forbidden("Bu alanı yönetme yetkin yok.");
  return a;
}

/** Kişisel veri (telefon, e-posta) yalnız ana yöneticilere görünür; görüntüleme denetim kaydına düşer. */
export function canViewPersonalData(actor: Actor | null): boolean {
  return isMainAdmin(actor);
}

/** Duyuru kanalına yazabilir mi. */
export function canAnnounce(actor: Actor | null): boolean {
  return !!actor && (actor.isMainAdmin || actor.canAnnounce);
}
