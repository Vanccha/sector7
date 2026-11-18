/** Mesajlaşma servisi: kanal listesi, kanal görünümü, sayfalama, mesaj gönderme, okundu işareti. */
import { and, asc, desc, eq, inArray, max, ne, or, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { areas, channelReads, channels, messages, tickets, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageArea, loadActor, requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { notFound } from "@/lib/contracts/errors";
import {
  channelLink,
  channelRefSchema,
  mentionCandidates,
  MESSAGE_PAGE_SIZE,
  newerMessagesSchema,
  olderMessagesSchema,
  sendMessageSchema,
  type ChannelListView,
  type ChannelSummary,
  type ChannelView,
  type MessageView,
  type SendResult,
} from "@/lib/contracts/messaging";
import type { UserOption } from "@/lib/contracts/plan";
import { notify } from "@/lib/notify";
import {
  canReadChannel,
  getAnnouncementChannel,
  getAreaChannel,
  requireChannelReader,
  requireChannelWriter,
  writeAccess,
  type ChannelContext,
} from "./channel-access";
import { ticketRefSchema } from "@/lib/contracts/tickets";
import { iso } from "./plan-common";
import { publishEvent } from "./realtime/publish";
import { postRequestMessage } from "./ticket-requests";
import {
  areaRecipients,
  canViewTicket,
  loadUsers,
  mainAdminIds,
  pendingRequestOf,
  ticketLink,
  type RequestDbRow,
} from "./ticket-common";

const TICKET_LIST_LIMIT = 50;
const NEWER_LIMIT = 100;
const MENTIONABLE_LIMIT = 200;
const MENTION_CANDIDATE_LIMIT = 30;

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

type ChannelStats = { unread: number; lastMessageAt: Date | null };

/** Kanal başına okunmamış sayısı ve son mesaj anı; tek sorgu. */
async function channelStats(db: DbOrTx, actor: Actor, channelIds: string[]): Promise<Map<string, ChannelStats>> {
  const out = new Map<string, ChannelStats>();
  if (channelIds.length === 0) return out;
  const unreadExpr = sql<number>`count(*) filter (where ${messages.createdAt} > coalesce(${channelReads.lastReadAt}, (select u.created_at from "user" u where u.id = ${actor.id})) and (${messages.authorId} is null or ${messages.authorId} <> ${actor.id}))`.mapWith(
    Number,
  );
  const rows = await db
    .select({ channelId: messages.channelId, last: max(messages.createdAt), unread: unreadExpr })
    .from(messages)
    .leftJoin(channelReads, and(eq(channelReads.channelId, messages.channelId), eq(channelReads.userId, actor.id)))
    .where(inArray(messages.channelId, channelIds))
    .groupBy(messages.channelId);
  for (const r of rows) out.set(r.channelId, { unread: r.unread, lastMessageAt: r.last });
  return out;
}

const NO_STATS: ChannelStats = { unread: 0, lastMessageAt: null };

function summaryOf(actor: Actor, ctx: ChannelContext, stats: ChannelStats | undefined): ChannelSummary {
  const s = stats ?? NO_STATS;
  const kind = ctx.channel.kind;
  const w = writeAccess(actor, ctx);
  return {
    id: ctx.channel.id,
    kind,
    name: kind === "ticket" ? (ctx.ticket?.title ?? ctx.channel.name) : kind === "area" ? (ctx.area?.name ?? ctx.channel.name) : "Duyurular",
    areaId: ctx.area?.id ?? null,
    areaName: ctx.area?.name ?? null,
    ticketId: ctx.ticket?.id ?? null,
    ticketStatus: ctx.ticket?.status ?? null,
    archived: !!ctx.area?.archivedAt,
    unread: s.unread,
    lastMessageAt: iso(s.lastMessageAt),
    canWrite: w.ok,
  };
}

/** Aktörün görebildiği, mesajı olan ticket kanalları (son mesaj yeniden eskiye, en fazla 50). */
async function visibleTicketChannels(db: DbOrTx, actor: Actor) {
  const last = db
    .select({ channelId: messages.channelId, lastAt: max(messages.createdAt).as("last_at") })
    .from(messages)
    .groupBy(messages.channelId)
    .as("last_msg");
  const visible = actor.isMainAdmin
    ? undefined
    : or(
        eq(tickets.assigneeId, actor.id),
        actor.managedAreaIds.length > 0 ? inArray(tickets.areaId, actor.managedAreaIds) : undefined,
      );
  const rows = await db
    .select({
      channel: channels,
      ticket: {
        id: tickets.id,
        title: tickets.title,
        areaId: tickets.areaId,
        assigneeId: tickets.assigneeId,
        status: tickets.status,
      },
      area: { id: areas.id, name: areas.name, archivedAt: areas.archivedAt },
    })
    .from(channels)
    .innerJoin(tickets, eq(tickets.id, channels.ticketId))
    .innerJoin(areas, eq(areas.id, tickets.areaId))
    .innerJoin(last, eq(last.channelId, channels.id))
    .where(and(eq(channels.kind, "ticket"), visible))
    .orderBy(desc(last.lastAt), desc(channels.id))
    .limit(TICKET_LIST_LIMIT);
  return rows.filter((r) => canViewTicket(actor, r.ticket));
}

export async function listChannels(db: DB, actor: Actor | null): Promise<ChannelListView> {
  const a = requireActor(actor);
  const annChannel = await getAnnouncementChannel(db);

  const areaRows = await db
    .select({ area: { id: areas.id, name: areas.name, archivedAt: areas.archivedAt }, channel: channels })
    .from(areas)
    .leftJoin(channels, and(eq(channels.kind, "area"), eq(channels.areaId, areas.id)));
  const areaCtxs: ChannelContext[] = [];
  for (const r of areaRows) {
    const channel = r.channel ?? (await getAreaChannel(db, r.area));
    areaCtxs.push({ channel, area: r.area, ticket: null });
  }
  areaCtxs.sort((x, y) => {
    const ax = x.area?.archivedAt ? 1 : 0;
    const ay = y.area?.archivedAt ? 1 : 0;
    if (ax !== ay) return ax - ay;
    return (x.area?.name ?? "").localeCompare(y.area?.name ?? "", "tr");
  });

  const ticketRows = await visibleTicketChannels(db, a);
  const ticketCtxs: ChannelContext[] = ticketRows.map((r) => ({ channel: r.channel, area: r.area, ticket: r.ticket }));

  const annCtx: ChannelContext = { channel: annChannel, area: null, ticket: null };
  const stats = await channelStats(
    db,
    a,
    [annCtx, ...areaCtxs, ...ticketCtxs].map((c) => c.channel.id),
  );
  const mk = (c: ChannelContext) => summaryOf(a, c, stats.get(c.channel.id));
  const announcement = mk(annCtx);
  const areaList = areaCtxs.map(mk);
  const ticketList = ticketCtxs.map(mk);
  const totalUnread = [announcement, ...areaList, ...ticketList].reduce((n, c) => n + c.unread, 0);
  return { announcement, areas: areaList, tickets: ticketList, totalUnread };
}

export async function unreadMessageCount(db: DB, actor: Actor | null): Promise<number> {
  const a = requireActor(actor);
  const ann = await getAnnouncementChannel(db);
  const areaChannels = await db.select({ id: channels.id }).from(channels).where(eq(channels.kind, "area"));
  const ticketRows = await visibleTicketChannels(db, a);
  const ids = [ann.id, ...areaChannels.map((c) => c.id), ...ticketRows.map((r) => r.channel.id)];
  const stats = await channelStats(db, a, ids);
  let total = 0;
  for (const s of stats.values()) total += s.unread;
  return total;
}

async function toMessageViews(db: DbOrTx, actor: Actor, rows: (typeof messages.$inferSelect)[]): Promise<MessageView[]> {
  const authors = await loadUsers(
    db,
    rows.map((r) => r.authorId),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    author: r.authorId ? (authors.get(r.authorId) ?? null) : null,
    body: r.body,
    requestId: r.requestId,
    createdAt: iso(r.createdAt) ?? "",
    mine: r.authorId === actor.id,
  }));
}

/** İmleç mesajı aynı kanalda olmalı; satır karşılaştırması veritabanında yapılır (mikrosaniye kaybı olmasın). */
async function requireCursor(db: DbOrTx, channelId: string, messageId: string): Promise<void> {
  const [c] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
    .limit(1);
  if (!c) throw notFound("Mesaj bulunamadı.");
}

const cursorRow = (id: string) => sql`(select c.created_at, c.id from messages c where c.id = ${id})`;

/** Aktörün cevaplayabileceği/yazabileceği bekleyen talep (yalnız ticket kanalı). */
async function pendingRequestFor(db: DbOrTx, actor: Actor, ctx: ChannelContext): Promise<RequestDbRow | null> {
  if (ctx.channel.kind !== "ticket" || !ctx.ticket) return null;
  const r = await pendingRequestOf(db, ctx.ticket.id);
  if (!r) return null;
  if (r.requesterId === actor.id) return r;
  return canManageArea(actor, ctx.ticket.areaId) ? r : null;
}

async function mentionablesOf(db: DbOrTx, ctx: ChannelContext): Promise<UserOption[]> {
  const toOption = (r: { id: string; name: string; username: string | null }): UserOption => ({
    id: r.id,
    name: r.name,
    username: r.username ?? "",
  });
  if (ctx.channel.kind !== "ticket" || !ctx.ticket) {
    const rows = await db
      .select({ id: user.id, name: user.name, username: user.username })
      .from(user)
      .where(eq(user.active, true))
      .orderBy(asc(user.name), asc(user.id))
      .limit(MENTIONABLE_LIMIT);
    return rows.map(toOption);
  }
  const ids = new Set<string>(await mainAdminIds(db));
  if (ctx.ticket.assigneeId) ids.add(ctx.ticket.assigneeId);
  const [area] = await db.select({ managerId: areas.managerId }).from(areas).where(eq(areas.id, ctx.ticket.areaId)).limit(1);
  if (area?.managerId) ids.add(area.managerId);
  const rows = await db
    .select({ id: user.id, name: user.name, username: user.username })
    .from(user)
    .where(and(inArray(user.id, [...ids]), eq(user.active, true)))
    .orderBy(asc(user.name), asc(user.id))
    .limit(MENTIONABLE_LIMIT);
  return rows.map(toOption);
}

/* ------------------------------------------------------------------ */
/* Okuma                                                               */
/* ------------------------------------------------------------------ */

export async function getChannelView(db: DB, actor: Actor | null, raw: { channelId: string }): Promise<ChannelView> {
  const input = channelRefSchema.parse(raw);
  const { actor: a, ctx } = await requireChannelReader(db, actor, input.channelId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.channelId, ctx.channel.id))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(MESSAGE_PAGE_SIZE + 1);
  const hasOlder = rows.length > MESSAGE_PAGE_SIZE;
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).reverse();
  const stats = await channelStats(db, a, [ctx.channel.id]);
  const w = writeAccess(a, ctx);
  const pending = await pendingRequestFor(db, a, ctx);
  return {
    channel: summaryOf(a, ctx, stats.get(ctx.channel.id)),
    messages: await toMessageViews(db, a, page),
    hasOlder,
    canWrite: w.ok,
    writeHint: w.ok ? null : w.reason,
    pendingRequest: pending ? { id: pending.id, kind: pending.kind } : null,
    mentionables: await mentionablesOf(db, ctx),
  };
}

export async function listOlderMessages(
  db: DB,
  actor: Actor | null,
  raw: { channelId: string; beforeId: string },
): Promise<{ messages: MessageView[]; hasOlder: boolean }> {
  const input = olderMessagesSchema.parse(raw);
  const { actor: a } = await requireChannelReader(db, actor, input.channelId);
  await requireCursor(db, input.channelId, input.beforeId);
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.channelId, input.channelId),
        sql`(${messages.createdAt}, ${messages.id}) < ${cursorRow(input.beforeId)}`,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(MESSAGE_PAGE_SIZE + 1);
  const hasOlder = rows.length > MESSAGE_PAGE_SIZE;
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).reverse();
  return { messages: await toMessageViews(db, a, page), hasOlder };
}

export async function listNewerMessages(
  db: DB,
  actor: Actor | null,
  raw: { channelId: string; afterId: string | null },
): Promise<MessageView[]> {
  const input = newerMessagesSchema.parse(raw);
  const { actor: a } = await requireChannelReader(db, actor, input.channelId);
  if (input.afterId === null) {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.channelId, input.channelId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(MESSAGE_PAGE_SIZE);
    return toMessageViews(db, a, rows.reverse());
  }
  await requireCursor(db, input.channelId, input.afterId);
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.channelId, input.channelId),
        sql`(${messages.createdAt}, ${messages.id}) > ${cursorRow(input.afterId)}`,
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(NEWER_LIMIT);
  return toMessageViews(db, a, rows);
}

/* ------------------------------------------------------------------ */
/* Yazma                                                               */
/* ------------------------------------------------------------------ */

/** @bahsetme çözümü: aktif, kanalı okuyabilen, yazan hariç kullanıcılar. */
async function resolveMentions(db: DbOrTx, actor: Actor, ctx: ChannelContext, body: string): Promise<string[]> {
  const names = mentionCandidates(body).slice(0, MENTION_CANDIDATE_LIMIT);
  if (names.length === 0) return [];
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.username, names), eq(user.active, true), ne(user.id, actor.id)));
  if (ctx.channel.kind !== "ticket") return rows.map((r) => r.id);
  const out: string[] = [];
  for (const r of rows) {
    const target = await loadActor(db, r.id);
    if (target && canReadChannel(target, ctx)) out.push(r.id);
  }
  return out;
}

const snippet = (body: string) => body.slice(0, 140);

export async function sendMessage(
  db: DB,
  actor: Actor | null,
  raw: { channelId: string; body: string },
  now: Date = new Date(),
): Promise<SendResult> {
  const input = sendMessageSchema.parse(raw);
  const pre = await requireChannelWriter(db, actor, input.channelId);

  // Bekleyen talep varsa mesaj talep konuşmasına gider.
  const pending = await pendingRequestFor(db, pre.actor, pre.ctx);
  if (pending && pre.ctx.ticket) {
    const { messageId } = await postRequestMessage(db, pre.actor, { requestId: pending.id, body: input.body }, now);
    const ticket = pre.ctx.ticket;
    await db.transaction(async (tx) => {
      const mentions = await resolveMentions(tx, pre.actor, pre.ctx, input.body);
      if (mentions.length === 0) return;
      const alreadyNotified = new Set(
        pending.requesterId === pre.actor.id
          ? await areaRecipients(tx, ticket.areaId, pending.requesterId)
          : [pending.requesterId],
      );
      await notify(tx, {
        userIds: mentions.filter((id) => !alreadyNotified.has(id)),
        type: "mention",
        title: `${pre.actor.name} senden bahsetti — ${ticket.title}`,
        body: snippet(input.body),
        link: ticketLink(ticket.id),
      });
    });
    return { messageId };
  }

  return db.transaction(async (tx) => {
    const { actor: a, ctx } = await requireChannelWriter(tx, actor, input.channelId);
    const kind = ctx.channel.kind;
    const [row] = await tx
      .insert(messages)
      .values({ channelId: ctx.channel.id, authorId: a.id, kind: "text", body: input.body })
      .returning({ id: messages.id });
    if (!row) throw new Error("Mesaj kaydedilemedi.");
    const areaId = ctx.ticket?.areaId ?? ctx.area?.id ?? null;
    await publishEvent(tx, {
      kind: "message",
      channelId: ctx.channel.id,
      channelKind: kind,
      areaId,
      ticketId: ctx.ticket?.id ?? null,
      ticketAssigneeId: ctx.ticket?.assigneeId ?? null,
      messageId: row.id,
      authorId: a.id,
    });

    const mentions = await resolveMentions(tx, a, ctx, input.body);
    if (kind === "announcement") {
      const rows = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.active, true), ne(user.id, a.id)));
      await notify(tx, {
        userIds: rows.map((r) => r.id),
        type: "announcement",
        title: `Duyuru: ${a.name}`,
        body: snippet(input.body),
        link: channelLink(ctx.channel.id),
      });
    } else if (kind === "ticket" && ctx.ticket) {
      const ticket = ctx.ticket;
      const participants = new Set<string>(await areaRecipients(tx, ticket.areaId, a.id));
      if (ticket.assigneeId) participants.add(ticket.assigneeId);
      participants.delete(a.id);
      await notify(tx, {
        userIds: [...participants],
        type: "ticket_message",
        title: `${ticket.title}: yeni mesaj`,
        body: snippet(input.body),
        link: ticketLink(ticket.id),
      });
      await notify(tx, {
        userIds: mentions.filter((id) => !participants.has(id)),
        type: "mention",
        title: `${a.name} senden bahsetti — ${ticket.title}`,
        body: snippet(input.body),
        link: ticketLink(ticket.id),
      });
    } else {
      await notify(tx, {
        userIds: mentions,
        type: "mention",
        title: `${a.name} senden bahsetti — ${ctx.area?.name ?? ctx.channel.name}`,
        body: snippet(input.body),
        link: channelLink(ctx.channel.id),
      });
    }

    await audit(tx, {
      actorId: a.id,
      action: "message.send",
      entityType: "message",
      entityId: row.id,
      areaId,
      ticketId: ctx.ticket?.id ?? null,
      data: { channelId: ctx.channel.id, channelKind: kind, mentions },
    });
    return { messageId: row.id };
  });
}

export async function markChannelRead(
  db: DB,
  actor: Actor | null,
  raw: { channelId: string },
  now: Date = new Date(),
): Promise<void> {
  const input = channelRefSchema.parse(raw);
  const { actor: a, ctx } = await requireChannelReader(db, actor, input.channelId);
  await db
    .insert(channelReads)
    .values({ userId: a.id, channelId: ctx.channel.id, lastReadAt: now })
    .onConflictDoUpdate({
      target: [channelReads.userId, channelReads.channelId],
      set: { lastReadAt: sql`greatest(${channelReads.lastReadAt}, excluded.last_read_at)` },
    });
}

/**
 * Ticket konuşmasının kanal kimliği (yoksa açar). Ticket sayfası konuşmayı bununla gösterir.
 * Ticket'ı göremeyen için notFound.
 */
export async function getTicketChannelId(db: DB, actor: Actor | null, raw: { ticketId: string }): Promise<string> {
  const a = requireActor(actor);
  const { ticketId } = ticketRefSchema.parse(raw);
  const [t] = await db
    .select({ id: tickets.id, title: tickets.title, areaId: tickets.areaId, assigneeId: tickets.assigneeId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!t || !canViewTicket(a, t)) throw notFound("Ticket bulunamadı.");
  const find = () =>
    db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.kind, "ticket"), eq(channels.ticketId, t.id)))
      .limit(1);
  const [c] = await find();
  if (c) return c.id;
  await db.insert(channels).values({ kind: "ticket", ticketId: t.id, areaId: t.areaId, name: t.title }).onConflictDoNothing();
  const [c2] = await find();
  if (!c2) throw new Error("Ticket kanalı açılamadı.");
  return c2.id;
}
