/** Alan yönetimi (yalnız ana yönetici). Next.js'e bağımlı değildir. */
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { areas, auditLog, channelReads, channels, goals, messages, roadmaps, tickets, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { invalidState } from "@/lib/contracts/errors";
import {
  ACTIVE_TICKET_STATUSES,
  archiveAreaSchema,
  areaIdSchema,
  createAreaSchema,
  deleteAreaSchema,
  setAreaManagerSchema,
  updateAreaSchema,
  type AreaDeleteBlockers,
  type AreaRow,
  type ArchiveResult,
  type DeleteAreaResult,
  type UserOption,
} from "@/lib/contracts/plan";
import { getAreaOrThrow, iso } from "./plan-common";

async function countActiveTickets(db: DbOrTx, areaId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(tickets)
    .where(and(eq(tickets.areaId, areaId), inArray(tickets.status, [...ACTIVE_TICKET_STATUSES])));
  return r?.n ?? 0;
}

/** Tüm alanlar: önce aktifler (ada göre), sonra arşivliler. */
export async function listAreas(db: DbOrTx, actor: Actor | null): Promise<AreaRow[]> {
  requireMainAdmin(actor);
  const rows = await db
    .select({
      id: areas.id,
      name: areas.name,
      description: areas.description,
      managerId: areas.managerId,
      managerName: user.name,
      archivedAt: areas.archivedAt,
      githubRepo: areas.githubRepo,
    })
    .from(areas)
    .leftJoin(user, eq(user.id, areas.managerId))
    .orderBy(asc(areas.name));
  const counts = await db
    .select({ areaId: tickets.areaId, n: count() })
    .from(tickets)
    .where(inArray(tickets.status, [...ACTIVE_TICKET_STATUSES]))
    .groupBy(tickets.areaId);
  const byArea = new Map(counts.map((c) => [c.areaId, c.n]));
  const mapped: AreaRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    managerId: r.managerId,
    managerName: r.managerName,
    archivedAt: iso(r.archivedAt),
    activeTicketCount: byArea.get(r.id) ?? 0,
    githubRepo: r.githubRepo,
  }));
  return [...mapped.filter((a) => !a.archivedAt), ...mapped.filter((a) => a.archivedAt)];
}

/** Yönetici seçimi için aktif kullanıcılar. E-posta/telefon dönmez. */
export async function listUserOptions(db: DbOrTx, actor: Actor | null): Promise<UserOption[]> {
  requireMainAdmin(actor);
  const rows = await db
    .select({ id: user.id, name: user.name, username: user.username })
    .from(user)
    .where(eq(user.active, true))
    .orderBy(asc(user.name));
  return rows.map((r) => ({ id: r.id, name: r.name, username: r.username ?? "" }));
}

export async function createArea(db: DB, actor: Actor | null, raw: unknown): Promise<{ id: string }> {
  const a = requireMainAdmin(actor);
  const input = createAreaSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(areas)
      .values({ name: input.name, description: input.description })
      .returning({ id: areas.id });
    if (!row) throw new Error("Alan kaydedilemedi.");
    await tx.insert(channels).values({ kind: "area", areaId: row.id, name: input.name });
    await audit(tx, {
      actorId: a.id,
      action: "area.create",
      entityType: "area",
      entityId: row.id,
      areaId: row.id,
      data: { name: input.name },
    });
    return row;
  });
}

export async function updateArea(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = updateAreaSchema.parse(raw);
  await db.transaction(async (tx) => {
    const area = await getAreaOrThrow(tx, input.areaId);
    await tx
      .update(areas)
      .set({ name: input.name, description: input.description, updatedAt: new Date() })
      .where(eq(areas.id, area.id));
    await tx
      .update(channels)
      .set({ name: input.name })
      .where(and(eq(channels.areaId, area.id), eq(channels.kind, "area")));
    await audit(tx, {
      actorId: a.id,
      action: "area.update",
      entityType: "area",
      entityId: area.id,
      areaId: area.id,
      data: {
        from: { name: area.name, description: area.description },
        to: { name: input.name, description: input.description },
      },
    });
  });
}

export async function setAreaManager(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = setAreaManagerSchema.parse(raw);
  await db.transaction(async (tx) => {
    const area = await getAreaOrThrow(tx, input.areaId);
    if (area.archivedAt) throw invalidState("Arşivlenmiş alana yönetici atanamaz.");
    if (input.managerId) {
      const [u] = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, input.managerId), eq(user.active, true)))
        .limit(1);
      if (!u) throw invalidState("Seçilen kullanıcı bulunamadı ya da aktif değil.");
    }
    await tx.update(areas).set({ managerId: input.managerId, updatedAt: new Date() }).where(eq(areas.id, area.id));
    await audit(tx, {
      actorId: a.id,
      action: "area.set_manager",
      entityType: "area",
      entityId: area.id,
      areaId: area.id,
      subjectUserId: input.managerId,
      data: { from: area.managerId, to: input.managerId },
    });
  });
}

/** Aktif ticket varsa ve onay yoksa hiçbir şey değiştirmeden uyarı sonucu döner. */
export async function archiveArea(db: DB, actor: Actor | null, raw: unknown): Promise<ArchiveResult> {
  const a = requireMainAdmin(actor);
  const input = archiveAreaSchema.parse(raw);
  return db.transaction(async (tx) => {
    // Alan satırını kilitle: arşivleme yarışa girmesin.
    await tx.execute(sql`select id from areas where id = ${input.areaId} for update`);
    const area = await getAreaOrThrow(tx, input.areaId);
    if (area.archivedAt) throw invalidState("Bu alan zaten arşivlenmiş.");
    const activeTicketCount = await countActiveTickets(tx, area.id);
    if (activeTicketCount > 0 && !input.confirm) return { archived: false, activeTicketCount };
    await tx.update(areas).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(areas.id, area.id));
    await audit(tx, {
      actorId: a.id,
      action: "area.archive",
      entityType: "area",
      entityId: area.id,
      areaId: area.id,
      data: { activeTicketCount },
    });
    return { archived: true } as const;
  });
}

export async function unarchiveArea(db: DB, actor: Actor | null, raw: unknown): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = areaIdSchema.parse(raw);
  await db.transaction(async (tx) => {
    const area = await getAreaOrThrow(tx, input.areaId);
    if (!area.archivedAt) throw invalidState("Bu alan arşivlenmiş değil.");
    await tx.update(areas).set({ archivedAt: null, updatedAt: new Date() }).where(eq(areas.id, area.id));
    await audit(tx, {
      actorId: a.id,
      action: "area.unarchive",
      entityType: "area",
      entityId: area.id,
      areaId: area.id,
    });
  });
}

/**
 * Hiç geçmişi olmayan alanı kalıcı siler. Ticket, hedef, roadmap, ana alanı bu olan üye ya da kanalında
 * mesaj varsa silmez; sıfırdan büyük sayaçları `blockers` olarak döner. Yönetici ataması ve GitHub depo
 * eşlemesi engel değildir. Mesajlar hiçbir zaman silinmez; yalnız mesajsız kanal ve okunma kayıtları gider.
 */
export async function deleteArea(db: DB, actor: Actor | null, raw: unknown): Promise<DeleteAreaResult> {
  const a = requireMainAdmin(actor);
  const input = deleteAreaSchema.parse(raw);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from areas where id = ${input.areaId} for update`);
    const area = await getAreaOrThrow(tx, input.areaId);
    const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const areaChannels = tx.select({ id: channels.id }).from(channels).where(eq(channels.areaId, area.id));
    const found = {
      tickets: await one(tx.select({ n: count() }).from(tickets).where(eq(tickets.areaId, area.id))),
      goals: await one(tx.select({ n: count() }).from(goals).where(eq(goals.areaId, area.id))),
      roadmaps: await one(tx.select({ n: count() }).from(roadmaps).where(eq(roadmaps.areaId, area.id))),
      members: await one(tx.select({ n: count() }).from(user).where(eq(user.homeAreaId, area.id))),
      messages: await one(tx.select({ n: count() }).from(messages).where(inArray(messages.channelId, areaChannels))),
    };
    const blockers: AreaDeleteBlockers = {};
    for (const [k, n] of Object.entries(found)) if (n > 0) blockers[k as keyof AreaDeleteBlockers] = n;
    if (Object.keys(blockers).length > 0) return { deleted: false, blockers };

    await tx.delete(channelReads).where(inArray(channelReads.channelId, areaChannels));
    await tx.delete(channels).where(eq(channels.areaId, area.id));
    // Denetim kayıtları silinmez; yalnız silinen alana bağlantıları koparılır (entityId'de kimlik kalır).
    await tx.update(auditLog).set({ areaId: null }).where(eq(auditLog.areaId, area.id));
    await tx.delete(areas).where(eq(areas.id, area.id));
    await audit(tx, {
      actorId: a.id,
      action: "area.delete",
      entityType: "area",
      entityId: area.id,
      data: { areaId: area.id, name: area.name, archived: area.archivedAt !== null },
    });
    return { deleted: true } as const;
  });
}
