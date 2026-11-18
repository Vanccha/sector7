/** Ek süre ve geri çekme talepleri: açma, konuşma, onay/ret, geri alma. */
import { eq } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { ticketRequests, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageArea, requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { AppError, forbidden, invalidState } from "@/lib/contracts/errors";
import {
  approveRequestSchema,
  createRequestSchema,
  PENDING_STATUS_FOR,
  rejectRequestSchema,
  requestMessageSchema,
  requestRefSchema,
  REQUEST_KIND_LABELS,
} from "@/lib/contracts/tickets";
import { notify } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { addHours, resumeTimes } from "@/lib/ticket-time";
import {
  areaRecipients,
  lockRequest,
  lockTicket,
  postTicketMessage,
  RELEASE_FIELDS,
  ticketLink,
  type RequestDbRow,
  type TicketRow,
} from "./ticket-common";

const NOT_PENDING = "Bu talep artık beklemiyor.";

export async function createRequest(
  db: DB,
  actor: Actor | null,
  raw: { ticketId: string; kind: "extension" | "withdrawal"; reason: string },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const a = requireActor(actor);
  const input = createRequestSchema.parse(raw);
  return db.transaction(async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (t.assigneeId !== a.id) throw forbidden("Yalnız ticket'ı üstlenen kişi talep açabilir.");
    if (t.status === "extension_pending" || t.status === "withdrawal_pending") {
      throw invalidState("Bu ticket'ta zaten bekleyen bir talep var.");
    }
    if (t.status !== "taken") throw invalidState("Bu ticket için şu an talep açılamaz.");
    const settings = await getSettings(tx);
    const [req] = await tx
      .insert(ticketRequests)
      .values({
        ticketId: t.id,
        kind: input.kind,
        requesterId: a.id,
        reason: input.reason,
        respondBy: addHours(now, settings.managerResponseHours),
      })
      .returning({ id: ticketRequests.id });
    if (!req) throw new Error("Talep kaydedilemedi.");
    await tx
      .update(tickets)
      .set({ status: PENDING_STATUS_FOR[input.kind], pausedAt: now, updatedAt: now })
      .where(eq(tickets.id, t.id));
    await postTicketMessage(tx, t, { authorId: a.id, body: input.reason, requestId: req.id });
    await notify(tx, {
      userIds: await areaRecipients(tx, t.areaId, a.id),
      type: "request_new",
      title: `${REQUEST_KIND_LABELS[input.kind]} talebi`,
      body: `${a.name}, "${t.title}" için ${REQUEST_KIND_LABELS[input.kind].toLowerCase()} istedi.`,
      link: ticketLink(t.id),
    });
    await audit(tx, {
      actorId: a.id,
      action: "request.create",
      entityType: "ticket_request",
      entityId: req.id,
      areaId: t.areaId,
      ticketId: t.id,
      data: { kind: input.kind },
    });
    return { id: req.id };
  });
}

export async function postRequestMessage(
  db: DB,
  actor: Actor | null,
  raw: { requestId: string; body: string },
  now: Date = new Date(),
): Promise<void> {
  const a = requireActor(actor);
  const input = requestMessageSchema.parse(raw);
  await db.transaction(async (tx) => {
    const { request, ticket } = await lockRequest(tx, input.requestId);
    if (request.status !== "pending") throw invalidState(NOT_PENDING);
    const isRequester = request.requesterId === a.id;
    const isManager = !isRequester && canManageArea(a, ticket.areaId);
    if (!isRequester && !isManager) throw forbidden("Bu konuşmaya yazma yetkin yok.");

    const messageId = await postTicketMessage(tx, ticket, { authorId: a.id, body: input.body, requestId: request.id });
    if (isManager) {
      if (!request.awaitingRequesterAt) {
        await tx.update(ticketRequests).set({ awaitingRequesterAt: now }).where(eq(ticketRequests.id, request.id));
      }
      await notify(tx, {
        userIds: [request.requesterId],
        type: "request_message",
        title: "Talebin için yeni mesaj var",
        body: `"${ticket.title}" talebinde yönetici yazdı.`,
        link: ticketLink(ticket.id),
      });
    } else {
      if (request.awaitingRequesterAt) {
        const settings = await getSettings(tx);
        await tx
          .update(ticketRequests)
          .set({
            awaitingRequesterAt: null,
            respondBy: addHours(now, settings.managerResponseHours),
            remindedAt: null,
            overdueAt: null,
          })
          .where(eq(ticketRequests.id, request.id));
      }
      await notify(tx, {
        userIds: await areaRecipients(tx, ticket.areaId, request.requesterId),
        type: "request_message",
        title: "Talep konuşmasında yeni mesaj",
        body: `${a.name}, "${ticket.title}" talebine cevap yazdı.`,
        link: ticketLink(ticket.id),
      });
    }
    await audit(tx, {
      actorId: a.id,
      action: "request.message",
      entityType: "ticket_request",
      entityId: request.id,
      areaId: ticket.areaId,
      ticketId: ticket.id,
      data: { messageId },
    });
  });
}

/** Cevaplama yetkisi: alanı yönetebilir ve talep sahibi değil. */
function assertCanRespond(a: Actor, request: RequestDbRow, ticket: TicketRow) {
  if (request.requesterId === a.id) throw forbidden("Kendi talebini cevaplayamazsın.");
  if (!canManageArea(a, ticket.areaId)) throw forbidden("Bu talebi cevaplama yetkin yok.");
}

async function loadPendingForResponse(tx: DbOrTx, a: Actor, requestId: string) {
  const { request, ticket } = await lockRequest(tx, requestId);
  if (request.status !== "pending") throw invalidState(NOT_PENDING);
  assertCanRespond(a, request, ticket);
  return { request, ticket };
}

const withNote = (text: string, note?: string) => (note ? `${text} Not: ${note}` : text);

export async function approveRequest(
  db: DB,
  actor: Actor | null,
  raw: { requestId: string; grantedHours?: number; note?: string },
  now: Date = new Date(),
): Promise<void> {
  const a = requireActor(actor);
  const input = approveRequestSchema.parse(raw);
  await db.transaction(async (tx) => {
    const { request, ticket } = await loadPendingForResponse(tx, a, input.requestId);
    const isExtension = request.kind === "extension";
    if (isExtension && !input.grantedHours) {
      throw new AppError("VALIDATION", "Ek süre için saat belirt.", { grantedHours: "Saat belirt." });
    }
    const settings = await getSettings(tx);
    let text: string;
    if (isExtension) {
      const hours = input.grantedHours ?? 0;
      await tx
        .update(tickets)
        .set({ status: "taken", ...resumeTimes(ticket, now, settings.ticketWarnBeforeHours, hours), updatedAt: now })
        .where(eq(tickets.id, ticket.id));
      text = `Ek süre onaylandı: +${hours} saat.`;
    } else {
      await tx.update(tickets).set({ ...RELEASE_FIELDS, updatedAt: now }).where(eq(tickets.id, ticket.id));
      text = "Geri çekme onaylandı; ticket havuza döndü.";
    }
    await tx
      .update(ticketRequests)
      .set({
        status: "approved",
        grantedHours: isExtension ? (input.grantedHours ?? null) : null,
        respondedById: a.id,
        respondedAt: now,
        responseNote: input.note ?? null,
        awaitingRequesterAt: null,
      })
      .where(eq(ticketRequests.id, request.id));
    const body = withNote(text, input.note);
    await postTicketMessage(tx, ticket, { authorId: null, body, requestId: request.id });
    await notify(tx, {
      userIds: [request.requesterId],
      type: "request_answered",
      title: `${REQUEST_KIND_LABELS[request.kind]} talebin onaylandı`,
      body,
      link: ticketLink(ticket.id),
    });
    await audit(tx, {
      actorId: a.id,
      action: "request.approve",
      entityType: "ticket_request",
      entityId: request.id,
      areaId: ticket.areaId,
      ticketId: ticket.id,
      data: { kind: request.kind, grantedHours: isExtension ? input.grantedHours : undefined },
    });
  });
}

export async function rejectRequest(
  db: DB,
  actor: Actor | null,
  raw: { requestId: string; note?: string },
  now: Date = new Date(),
): Promise<void> {
  const a = requireActor(actor);
  const input = rejectRequestSchema.parse(raw);
  await db.transaction(async (tx) => {
    const { request, ticket } = await loadPendingForResponse(tx, a, input.requestId);
    const settings = await getSettings(tx);
    await tx
      .update(tickets)
      .set({ status: "taken", ...resumeTimes(ticket, now, settings.ticketWarnBeforeHours, 0), updatedAt: now })
      .where(eq(tickets.id, ticket.id));
    await tx
      .update(ticketRequests)
      .set({
        status: "rejected",
        respondedById: a.id,
        respondedAt: now,
        responseNote: input.note ?? null,
        awaitingRequesterAt: null,
      })
      .where(eq(ticketRequests.id, request.id));
    const body = withNote("Talep reddedildi; geri sayım kaldığı yerden devam ediyor.", input.note);
    await postTicketMessage(tx, ticket, { authorId: null, body, requestId: request.id });
    await notify(tx, {
      userIds: [request.requesterId],
      type: "request_answered",
      title: `${REQUEST_KIND_LABELS[request.kind]} talebin reddedildi`,
      body,
      link: ticketLink(ticket.id),
    });
    await audit(tx, {
      actorId: a.id,
      action: "request.reject",
      entityType: "ticket_request",
      entityId: request.id,
      areaId: ticket.areaId,
      ticketId: ticket.id,
      data: { kind: request.kind },
    });
  });
}

export async function cancelRequest(
  db: DB,
  actor: Actor | null,
  raw: { requestId: string },
  now: Date = new Date(),
): Promise<void> {
  const a = requireActor(actor);
  const input = requestRefSchema.parse(raw);
  await db.transaction(async (tx) => {
    const { request, ticket } = await lockRequest(tx, input.requestId);
    if (request.requesterId !== a.id) throw forbidden("Yalnız talebi açan kişi geri alabilir.");
    if (request.status !== "pending") throw invalidState(NOT_PENDING);
    const settings = await getSettings(tx);
    await tx
      .update(tickets)
      .set({ status: "taken", ...resumeTimes(ticket, now, settings.ticketWarnBeforeHours, 0), updatedAt: now })
      .where(eq(tickets.id, ticket.id));
    await tx
      .update(ticketRequests)
      .set({ status: "cancelled", respondedAt: now, awaitingRequesterAt: null })
      .where(eq(ticketRequests.id, request.id));
    await postTicketMessage(tx, ticket, {
      authorId: null,
      body: "Talep geri alındı; geri sayım devam ediyor.",
      requestId: request.id,
    });
    await audit(tx, {
      actorId: a.id,
      action: "request.cancel",
      entityType: "ticket_request",
      entityId: request.id,
      areaId: ticket.areaId,
      ticketId: ticket.id,
      data: { kind: request.kind },
    });
  });
}
