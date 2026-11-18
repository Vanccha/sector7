/**
 * Aşama 3 servislerinin ortak yardımcıları — SÖZLEŞME (teknik lider yazar; alt ajanlar kullanır, değiştirmez).
 * Next.js'e bağımlı değildir.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { areas, channels, messages, sprints, ticketRejections, ticketRequests, tickets, user } from "@/db/schema";
import { canManageArea } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { forbidden, notFound } from "@/lib/contracts/errors";
import type { UserOption } from "@/lib/contracts/plan";
import type { Countdown, RejectionQuota, TicketCard } from "@/lib/contracts/tickets";
import { iso } from "./plan-common";

export type TicketRow = typeof tickets.$inferSelect;
export type RequestDbRow = typeof ticketRequests.$inferSelect;

export const ticketLink = (ticketId: string) => `/ticket/${ticketId}`;

/** Ticket'ı satır kilidiyle okur (transaction içinde çağrılmalı). */
export async function lockTicket(tx: DbOrTx, ticketId: string): Promise<TicketRow> {
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update").limit(1);
  if (!t) throw notFound("Ticket bulunamadı.");
  return t;
}

/** Talebi ve ticket'ını kilitler (önce ticket, sonra talep — kilit sırası her yerde aynı). */
export async function lockRequest(tx: DbOrTx, requestId: string): Promise<{ request: RequestDbRow; ticket: TicketRow }> {
  const [r0] = await tx.select({ ticketId: ticketRequests.ticketId }).from(ticketRequests).where(eq(ticketRequests.id, requestId)).limit(1);
  if (!r0) throw notFound("Talep bulunamadı.");
  const ticket = await lockTicket(tx, r0.ticketId);
  const [request] = await tx.select().from(ticketRequests).where(eq(ticketRequests.id, requestId)).for("update").limit(1);
  if (!request) throw notFound("Talep bulunamadı.");
  return { request, ticket };
}

/** Ticket'ı görebilir mi: üzerindeki kişi (teklif dahil) ya da alanı yönetebilen. */
export function canViewTicket(actor: Actor | null, t: { areaId: string; assigneeId: string | null }): boolean {
  if (!actor) return false;
  return t.assigneeId === actor.id || canManageArea(actor, t.areaId);
}

export function requireTicketViewer(actor: Actor | null, t: { areaId: string; assigneeId: string | null }) {
  if (!canViewTicket(actor, t)) throw forbidden("Bu ticket'ı görme yetkin yok.");
}

export async function getActiveSprint(db: DbOrTx) {
  const [s] = await db.select().from(sprints).where(eq(sprints.status, "active")).limit(1);
  return s ?? null;
}

/** Kişinin sprintteki red hakkı durumu. Sprint yoksa kullanılan 0. */
export async function rejectionQuota(db: DbOrTx, userId: string, sprintId: string | null, limit: number): Promise<RejectionQuota> {
  let used = 0;
  if (sprintId) {
    const [r] = await db
      .select({ n: count() })
      .from(ticketRejections)
      .where(and(eq(ticketRejections.userId, userId), eq(ticketRejections.sprintId, sprintId)));
    used = Number(r?.n ?? 0);
  }
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/** Ticket konuşma kanalı (tembel oluşturulur). Çağıran ticket satırını kilitlemiş olmalı. */
export async function ensureTicketChannel(tx: DbOrTx, t: { id: string; title: string; areaId: string }): Promise<string> {
  const [c] = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.kind, "ticket"), eq(channels.ticketId, t.id)))
    .limit(1);
  if (c) return c.id;
  const [n] = await tx
    .insert(channels)
    .values({ kind: "ticket", ticketId: t.id, areaId: t.areaId, name: t.title })
    .returning({ id: channels.id });
  if (!n) throw new Error("Ticket kanalı açılamadı.");
  return n.id;
}

/** Ticket konuşmasına mesaj yazar. authorId null ise sistem mesajı. */
export async function postTicketMessage(
  tx: DbOrTx,
  t: { id: string; title: string; areaId: string },
  m: { authorId: string | null; body: string; requestId?: string | null },
): Promise<string> {
  const channelId = await ensureTicketChannel(tx, t);
  const [row] = await tx
    .insert(messages)
    .values({
      channelId,
      authorId: m.authorId,
      kind: m.authorId ? "text" : "system",
      body: m.body,
      requestId: m.requestId ?? null,
    })
    .returning({ id: messages.id });
  if (!row) throw new Error("Mesaj kaydedilemedi.");
  return row.id;
}

export async function mainAdminIds(db: DbOrTx, exclude?: string | null): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.isMainAdmin, true), eq(user.active, true)));
  return rows.map((r) => r.id).filter((id) => id !== exclude);
}

/**
 * Alanla ilgili bildirim alıcıları: alanın (aktif) yöneticisi; yoksa ya da hariç tutulan kişiyse ana yöneticiler.
 * `exclude` genelde işlemi yapan / talep sahibi.
 */
export async function areaRecipients(db: DbOrTx, areaId: string, exclude?: string | null): Promise<string[]> {
  const [a] = await db
    .select({ managerId: areas.managerId, archivedAt: areas.archivedAt, managerActive: user.active })
    .from(areas)
    .leftJoin(user, eq(user.id, areas.managerId))
    .where(eq(areas.id, areaId))
    .limit(1);
  if (a?.managerId && a.managerActive && !a.archivedAt && a.managerId !== exclude) return [a.managerId];
  return mainAdminIds(db, exclude);
}

/** Ticket'taki bekleyen talebi `cancelled` yapar (teslim, sprint sonu kararları). Ticket alanlarına dokunmaz. */
export async function cancelPendingRequest(tx: DbOrTx, ticketId: string, now: Date): Promise<RequestDbRow | null> {
  const [r] = await tx
    .update(ticketRequests)
    .set({ status: "cancelled", respondedAt: now, awaitingRequesterAt: null })
    .where(and(eq(ticketRequests.ticketId, ticketId), eq(ticketRequests.status, "pending")))
    .returning();
  return r ?? null;
}

export async function pendingRequestOf(db: DbOrTx, ticketId: string): Promise<RequestDbRow | null> {
  const [r] = await db
    .select()
    .from(ticketRequests)
    .where(and(eq(ticketRequests.ticketId, ticketId), eq(ticketRequests.status, "pending")))
    .limit(1);
  return r ?? null;
}

export async function loadUsers(db: DbOrTx, ids: (string | null | undefined)[]): Promise<Map<string, UserOption>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, UserOption>();
  if (uniq.length === 0) return map;
  const rows = await db.select({ id: user.id, name: user.name, username: user.username }).from(user).where(inArray(user.id, uniq));
  for (const r of rows) map.set(r.id, { id: r.id, name: r.name, username: r.username ?? "" });
  return map;
}

export async function areaNames(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const rows = await db.select({ id: areas.id, name: areas.name }).from(areas).where(inArray(areas.id, uniq));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const toCountdown = (t: { dueAt: Date | null; pausedAt: Date | null }): Countdown => ({
  dueAt: iso(t.dueAt),
  pausedAt: iso(t.pausedAt),
});

export function toTicketCard(t: TicketRow, areaName: string): TicketCard {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    areaId: t.areaId,
    areaName,
    sprintId: t.sprintId,
    takenAt: iso(t.takenAt),
    countdown: toCountdown(t),
  };
}

/** Ticket'ı kişiden alıp havuza döndürürken sıfırlanan alanlar. */
export const RELEASE_FIELDS = {
  status: "returned_to_pool" as const,
  assigneeId: null,
  offeredAt: null,
  takenAt: null,
  dueAt: null,
  pausedAt: null,
  warnedAt: null,
  expiredNotifiedAt: null,
};
