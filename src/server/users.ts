/**
 * Aşama 5 — üye yönetimi (yalnız ana yönetici; reclaimTicket alan yöneticisine de açık).
 * Pasifleştirme kararı: pasif kişi giriş yapamaz, açık oturumları kapanır; elindeki ticket'lara
 * otomatik bir şey olmaz. Ticket'lar `reclaimTicket` ile havuza döndürülür.
 * Next.js'e bağımlı değildir.
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { areas, session, sprints, submissions, tickets, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { revokeRememberedDevices } from "./remembered-devices";
import { canManageArea, requireActor, requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import {
  listUsersSchema,
  reclaimTicketSchema,
  setHomeAreaSchema,
  setMainAdminSchema,
  setUserActiveSchema,
  userRefSchema,
  type PersonalData,
  type UserAdminRow,
} from "@/lib/contracts/admin";
import { AppError, forbidden, invalidState, notFound } from "@/lib/contracts/errors";
import { IN_PROGRESS_STATUSES } from "@/lib/contracts/tickets";
import { issueResetLink, setMainAdmin } from "./accounts";
import { cancelPendingRequest, lockTicket, postTicketMessage, RELEASE_FIELDS } from "./ticket-common";

const HELD_STATUSES = ["offered", ...IN_PROGRESS_STATUSES] as const;

async function countHeld(db: DbOrTx, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.assigneeId, userId), inArray(tickets.status, [...HELD_STATUSES])));
  return Number(r?.n ?? 0);
}

export async function listUsers(db: DbOrTx, actor: Actor | null, raw: unknown = {}): Promise<UserAdminRow[]> {
  requireMainAdmin(actor);
  const input = listUsersSchema.parse(raw ?? {});

  const conds: (SQL | undefined)[] = [];
  if (input.query) {
    const like = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
    conds.push(or(ilike(user.name, like), ilike(user.username, like)));
  }
  if (input.status === "active") conds.push(eq(user.active, true));
  if (input.status === "inactive") conds.push(eq(user.active, false));

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      homeAreaId: user.homeAreaId,
      homeAreaName: areas.name,
      isMainAdmin: user.isMainAdmin,
      canAnnounce: user.canAnnounce,
      active: user.active,
      createdAt: user.createdAt,
    })
    .from(user)
    .leftJoin(areas, eq(areas.id, user.homeAreaId))
    .where(and(...conds))
    .orderBy(asc(user.name), asc(user.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const managed = await db
    .select({ id: areas.id, name: areas.name, managerId: areas.managerId })
    .from(areas)
    .where(and(inArray(areas.managerId, ids), isNull(areas.archivedAt)))
    .orderBy(asc(areas.name));
  const managedBy = new Map<string, { id: string; name: string }[]>();
  for (const a of managed) {
    if (!a.managerId) continue;
    const list = managedBy.get(a.managerId) ?? [];
    list.push({ id: a.id, name: a.name });
    managedBy.set(a.managerId, list);
  }

  const heldRows = await db
    .select({ userId: tickets.assigneeId, n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(inArray(tickets.assigneeId, ids), inArray(tickets.status, [...HELD_STATUSES])))
    .groupBy(tickets.assigneeId);
  const held = new Map(heldRows.map((r) => [r.userId, Number(r.n)]));

  const [active] = await db.select({ id: sprints.id }).from(sprints).where(eq(sprints.status, "active")).limit(1);
  const submitted = new Map<string, number>();
  if (active) {
    const subRows = await db
      .select({ userId: submissions.userId, n: sql<number>`count(distinct ${submissions.ticketId})::int` })
      .from(submissions)
      .innerJoin(tickets, eq(tickets.id, submissions.ticketId))
      .where(and(eq(tickets.sprintId, active.id), inArray(submissions.userId, ids)))
      .groupBy(submissions.userId);
    for (const r of subRows) submitted.set(r.userId, Number(r.n));
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username ?? "",
    homeArea: r.homeAreaId && r.homeAreaName ? { id: r.homeAreaId, name: r.homeAreaName } : null,
    managedAreas: managedBy.get(r.id) ?? [],
    isMainAdmin: r.isMainAdmin,
    canAnnounce: r.canAnnounce,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    heldTickets: held.get(r.id) ?? 0,
    submittedThisSprint: submitted.get(r.id) ?? 0,
  }));
}

/** E-posta ve telefonu döndürür; her görüntüleme denetim kaydına düşer. */
export async function revealPersonalData(db: DB, actor: Actor | null, raw: unknown): Promise<PersonalData> {
  const a = requireMainAdmin(actor);
  const input = userRefSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select({ id: user.id, email: user.email, phone: user.phone })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!u) throw notFound("Kişi bulunamadı.");
    await audit(tx, {
      actorId: a.id,
      action: "personal_data.view",
      entityType: "user",
      entityId: u.id,
      subjectUserId: u.id,
      data: { fields: ["email", "phone"] },
    });
    return { userId: u.id, email: u.email, phone: u.phone };
  });
}

export async function setHomeArea(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = setHomeAreaSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [u] = await tx
      .select({ id: user.id, homeAreaId: user.homeAreaId })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);
    if (!u) throw notFound("Kişi bulunamadı.");
    if (input.areaId) {
      const [ar] = await tx.select({ id: areas.id, archivedAt: areas.archivedAt }).from(areas).where(eq(areas.id, input.areaId)).limit(1);
      if (!ar) throw notFound("Alan bulunamadı.");
      if (ar.archivedAt) {
        throw new AppError("VALIDATION", "Arşivlenmiş alan ana alan olarak seçilemez.", { areaId: "Arşivlenmiş alan seçilemez." });
      }
    }
    if (u.homeAreaId === input.areaId) return;
    await tx.update(user).set({ homeAreaId: input.areaId, updatedAt: now }).where(eq(user.id, u.id));
    await audit(tx, {
      actorId: a.id,
      action: "user.set_home_area",
      entityType: "user",
      entityId: u.id,
      subjectUserId: u.id,
      data: { from: u.homeAreaId, to: input.areaId },
    });
  });
}

export async function setUserActive(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = setUserActiveSchema.parse(raw);
  if (!input.active && input.userId === a.id) throw invalidState("Kendi hesabını pasifleştiremezsin.");
  await db.transaction(async (tx) => {
    const [u] = await tx
      .select({ id: user.id, active: user.active, isMainAdmin: user.isMainAdmin })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);
    if (!u) throw notFound("Kişi bulunamadı.");
    if (u.active === input.active) return;
    if (!input.active && u.isMainAdmin) {
      // Eşzamanlı pasifleştirmelere karşı aktif ana yöneticileri kilitle.
      const admins = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.isMainAdmin, true), eq(user.active, true)))
        .for("update");
      if (!admins.some((x) => x.id !== u.id)) throw invalidState("Son aktif ana yönetici pasifleştirilemez.");
    }
    await tx.update(user).set({ active: input.active, updatedAt: now }).where(eq(user.id, u.id));
    if (!input.active) {
      await tx.delete(session).where(eq(session.userId, u.id));
      await revokeRememberedDevices(tx, u.id);
    }
    await audit(tx, {
      actorId: a.id,
      action: input.active ? "user.activate" : "user.deactivate",
      entityType: "user",
      entityId: u.id,
      subjectUserId: u.id,
      data: { heldTickets: await countHeld(tx, u.id) },
    });
  });
}

/** Pasif kişide kalan teklif / sürmekte olan ticket'ı havuza döndürür (aynı sprint). */
export async function reclaimTicket(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const a = requireActor(actor);
  const input = reclaimTicketSchema.parse(raw);
  await db.transaction(async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (!canManageArea(a, t.areaId)) throw forbidden("Bu alanı yönetme yetkin yok.");
    if (!t.assigneeId) throw invalidState("Yalnız pasif kişide kalan ticket geri alınabilir.");
    const [holder] = await tx.select({ active: user.active }).from(user).where(eq(user.id, t.assigneeId)).limit(1);
    if (!holder || holder.active) throw invalidState("Yalnız pasif kişide kalan ticket geri alınabilir.");
    if (!(HELD_STATUSES as readonly string[]).includes(t.status)) {
      throw invalidState("Yalnız teklif edilmiş ya da sürmekte olan ticket geri alınabilir.");
    }
    await cancelPendingRequest(tx, t.id, now);
    await tx
      .update(tickets)
      .set({ ...RELEASE_FIELDS, updatedAt: now })
      .where(eq(tickets.id, t.id));
    await postTicketMessage(tx, t, { authorId: null, body: "Kişi pasif olduğu için ticket havuza geri alındı." });
    await audit(tx, {
      actorId: a.id,
      action: "ticket.reclaim",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
      subjectUserId: t.assigneeId,
      data: { previousStatus: t.status },
    });
  });
}

/** Şifre sıfırlama bağlantısı; pasif kişiye de üretilir, `active` ile arayüz uyarabilir. */
export async function issueResetLinkFor(db: DB, actor: Actor | null, raw: unknown) {
  requireMainAdmin(actor);
  const input = userRefSchema.parse(raw);
  const link = await issueResetLink(db, actor, input.userId);
  const [u] = await db.select({ active: user.active }).from(user).where(eq(user.id, input.userId)).limit(1);
  return { link, active: u?.active ?? false };
}

export async function setMainAdminFor(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  requireMainAdmin(actor);
  const input = setMainAdminSchema.parse(raw);
  if (input.value) {
    const [u] = await db.select({ active: user.active }).from(user).where(eq(user.id, input.userId)).limit(1);
    if (!u) throw notFound("Kişi bulunamadı.");
    if (!u.active) throw invalidState("Pasif kişiye ana yönetici yetkisi verilemez.");
  }
  await setMainAdmin(db, actor, input.userId, input.value);
}
