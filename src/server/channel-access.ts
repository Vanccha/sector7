/**
 * Kanal erişim kuralları — SÖZLEŞME (teknik lider yazar; alt ajanlar kullanır, değiştirmez).
 * Kurallar: src/lib/contracts/messaging.ts başlığı.
 */
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { areas, channels, tickets } from "@/db/schema";
import { canAnnounce, requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { forbidden, notFound } from "@/lib/contracts/errors";
import type { TicketStatus } from "@/lib/contracts/plan";
import { canViewTicket } from "./ticket-common";

export type ChannelRow = typeof channels.$inferSelect;

export type ChannelContext = {
  channel: ChannelRow;
  area: { id: string; name: string; archivedAt: Date | null } | null;
  ticket: { id: string; title: string; areaId: string; assigneeId: string | null; status: TicketStatus } | null;
};

export async function loadChannelContext(db: DbOrTx, channelId: string): Promise<ChannelContext> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) throw notFound("Kanal bulunamadı.");
  let ticket: ChannelContext["ticket"] = null;
  if (channel.kind === "ticket" && channel.ticketId) {
    const [t] = await db
      .select({ id: tickets.id, title: tickets.title, areaId: tickets.areaId, assigneeId: tickets.assigneeId, status: tickets.status })
      .from(tickets)
      .where(eq(tickets.id, channel.ticketId))
      .limit(1);
    ticket = t ?? null;
  }
  const areaId = channel.areaId ?? ticket?.areaId ?? null;
  let area: ChannelContext["area"] = null;
  if (areaId) {
    const [a] = await db
      .select({ id: areas.id, name: areas.name, archivedAt: areas.archivedAt })
      .from(areas)
      .where(eq(areas.id, areaId))
      .limit(1);
    area = a ?? null;
  }
  return { channel, area, ticket };
}

export function canReadChannel(actor: Actor | null, ctx: ChannelContext): boolean {
  if (!actor) return false;
  switch (ctx.channel.kind) {
    case "announcement":
    case "area":
      return true;
    case "ticket":
      return !!ctx.ticket && canViewTicket(actor, ctx.ticket);
  }
}

/** Yazabilir mi; değilse kullanıcıya gösterilecek kısa neden. */
export function writeAccess(actor: Actor | null, ctx: ChannelContext): { ok: true } | { ok: false; reason: string } {
  if (!actor) return { ok: false, reason: "Yazmak için giriş yapmalısın." };
  if (!canReadChannel(actor, ctx)) return { ok: false, reason: "Bu kanala erişimin yok." };
  switch (ctx.channel.kind) {
    case "announcement":
      return canAnnounce(actor)
        ? { ok: true }
        : { ok: false, reason: "Duyuru kanalına yalnız ana yöneticiler ve yetki verilen kişiler yazabilir." };
    case "area":
      return ctx.area?.archivedAt ? { ok: false, reason: "Arşivlenmiş alanın kanalı salt okunur." } : { ok: true };
    case "ticket":
      return { ok: true };
  }
}

export async function requireChannelReader(db: DbOrTx, actor: Actor | null, channelId: string) {
  const a = requireActor(actor);
  const ctx = await loadChannelContext(db, channelId);
  // Varlığını sızdırmamak için görünmeyen ticket kanalı "bulunamadı".
  if (!canReadChannel(a, ctx)) throw notFound("Kanal bulunamadı.");
  return { actor: a, ctx };
}

export async function requireChannelWriter(db: DbOrTx, actor: Actor | null, channelId: string) {
  const r = await requireChannelReader(db, actor, channelId);
  const w = writeAccess(r.actor, r.ctx);
  if (!w.ok) throw forbidden(w.reason);
  return r;
}

/** Ortak duyuru kanalı (yoksa oluşturur; tekil indeks yarışı önler). */
export async function getAnnouncementChannel(db: DbOrTx): Promise<ChannelRow> {
  const find = () => db.select().from(channels).where(eq(channels.kind, "announcement")).limit(1);
  const [c] = await find();
  if (c) return c;
  await db.insert(channels).values({ kind: "announcement", name: "Duyurular" }).onConflictDoNothing();
  const [c2] = await find();
  if (!c2) throw new Error("Duyuru kanalı açılamadı.");
  return c2;
}

/** Alanın kanalı (yoksa oluşturur). */
export async function getAreaChannel(db: DbOrTx, area: { id: string; name: string }): Promise<ChannelRow> {
  const find = () =>
    db.select().from(channels).where(and(eq(channels.kind, "area"), eq(channels.areaId, area.id))).limit(1);
  const [c] = await find();
  if (c) return c;
  await db.insert(channels).values({ kind: "area", areaId: area.id, name: area.name }).onConflictDoNothing();
  const [c2] = await find();
  if (!c2) throw new Error("Alan kanalı açılamadı.");
  return c2;
}
