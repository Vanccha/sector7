/**
 * Oturumdaki kişi ve rolleri — SÖZLEŞME.
 * Roller ayrı bir tabloda değil, veriden türetilir:
 *  - Ana yönetici: user.isMainAdmin
 *  - Alan yöneticisi: areas.managerId = user.id (arşivlenmemiş alanlar)
 *  - Üye: her aktif kullanıcı (ana alanı user.homeAreaId)
 * Bir kişi birden fazla role sahip olabilir.
 */
export type Actor = {
  id: string;
  username: string;
  name: string;
  isMainAdmin: boolean;
  canAnnounce: boolean;
  homeAreaId: string | null;
  /** Yönettiği (arşivlenmemiş) alanların kimlikleri. */
  managedAreaIds: string[];
};

export type RoleName = "main_admin" | "area_manager" | "member";

export function rolesOf(actor: Actor): RoleName[] {
  const r: RoleName[] = [];
  if (actor.isMainAdmin) r.push("main_admin");
  if (actor.managedAreaIds.length > 0) r.push("area_manager");
  r.push("member");
  return r;
}

export const ROLE_LABELS: Record<RoleName, string> = {
  main_admin: "Ana yönetici",
  area_manager: "Alan yöneticisi",
  member: "Üye",
};
