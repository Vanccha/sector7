/**
 * Zamanlanmış tarama: teklif dolumu, süre uyarısı/dolumu, talep hatırlatması/cevapsız işareti.
 * Her adım şemadaki işaret sütunlarıyla idempotenttir. Next.js'e bağımlı değildir.
 */
import { and, eq, isNotNull, isNull, lte, gt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { ticketRequests, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFER_MINUTES } from "@/lib/contracts/tickets";
import { notify } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { addHours, addMinutes, requestReminderAt, warnAt } from "@/lib/ticket-time";
import { areaRecipients, mainAdminIds, RELEASE_FIELDS, ticketLink } from "./ticket-common";

export type TickResult = {
  skipped: boolean;
  offersExpired: number;
  warned: number;
  expired: number;
  reminded: number;
  overdue: number;
};

export async function runScheduledTick(db: DB, now: Date = new Date()): Promise<TickResult> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('sector7-scheduler')) as ok`);
    const ok = (lock.rows[0] as { ok?: boolean } | undefined)?.ok === true;
    if (!ok) return { skipped: true, offersExpired: 0, warned: 0, expired: 0, reminded: 0, overdue: 0 };

    const settings = await getSettings(tx);
    const result: TickResult = { skipped: false, offersExpired: 0, warned: 0, expired: 0, reminded: 0, overdue: 0 };

    // 1) Teklif dolumu (hak düşmez).
    const offerCutoff = addMinutes(now, -OFFER_MINUTES);
    const staleOffers = await tx
      .select({ id: tickets.id, areaId: tickets.areaId, assigneeId: tickets.assigneeId })
      .from(tickets)
      .where(and(eq(tickets.status, "offered"), isNotNull(tickets.offeredAt), lte(tickets.offeredAt, offerCutoff)))
      .for("update", { skipLocked: true });
    for (const o of staleOffers) {
      const [r] = await tx
        .update(tickets)
        .set({ ...RELEASE_FIELDS, updatedAt: now })
        .where(and(eq(tickets.id, o.id), eq(tickets.status, "offered")))
        .returning({ id: tickets.id });
      if (!r) continue;
      result.offersExpired++;
      await audit(tx, {
        actorId: null,
        action: "ticket.offer_expired",
        entityType: "ticket",
        entityId: o.id,
        areaId: o.areaId,
        ticketId: o.id,
        subjectUserId: o.assigneeId,
        data: { reason: "timeout" },
      });
    }

    // 2) Süre uyarısı.
    const warnCandidates = await tx
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.status, "taken"),
          isNull(tickets.pausedAt),
          isNull(tickets.warnedAt),
          isNull(tickets.expiredNotifiedAt),
          isNotNull(tickets.dueAt),
          gt(tickets.dueAt, now),
          lte(tickets.dueAt, addHours(now, settings.ticketWarnBeforeHours)),
        ),
      )
      .for("update", { skipLocked: true });
    for (const t of warnCandidates) {
      if (!t.dueAt || warnAt(t.dueAt, settings.ticketWarnBeforeHours).getTime() > now.getTime()) continue;
      const [r] = await tx
        .update(tickets)
        .set({ warnedAt: now })
        .where(and(eq(tickets.id, t.id), eq(tickets.status, "taken"), isNull(tickets.warnedAt), isNull(tickets.pausedAt)))
        .returning({ id: tickets.id });
      if (!r) continue;
      result.warned++;
      await notify(tx, {
        userIds: [t.assigneeId],
        type: "ticket_due_soon",
        title: "Ticket süren azaldı",
        body: `"${t.title}" için teslim süresi yaklaşıyor.`,
        link: ticketLink(t.id),
      });
      await audit(tx, {
        actorId: null,
        action: "ticket.due_warned",
        entityType: "ticket",
        entityId: t.id,
        areaId: t.areaId,
        ticketId: t.id,
        subjectUserId: t.assigneeId,
        data: { dueAt: t.dueAt.toISOString() },
      });
    }

    // 3) Süre dolumu (ceza yok; teslim hâlâ açık).
    const expiredCandidates = await tx
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.status, "taken"),
          isNull(tickets.pausedAt),
          isNull(tickets.expiredNotifiedAt),
          isNotNull(tickets.dueAt),
          lte(tickets.dueAt, now),
        ),
      )
      .for("update", { skipLocked: true });
    for (const t of expiredCandidates) {
      const [r] = await tx
        .update(tickets)
        .set({ expiredNotifiedAt: now, warnedAt: t.warnedAt ?? now })
        .where(and(eq(tickets.id, t.id), eq(tickets.status, "taken"), isNull(tickets.expiredNotifiedAt), isNull(tickets.pausedAt)))
        .returning({ id: tickets.id });
      if (!r) continue;
      result.expired++;
      const recipients = [t.assigneeId, ...(await areaRecipients(tx, t.areaId))];
      await notify(tx, {
        userIds: recipients,
        type: "ticket_expired",
        title: "Ticket süresi doldu",
        body: `"${t.title}" için teslim süresi doldu.`,
        link: ticketLink(t.id),
      });
      await audit(tx, {
        actorId: null,
        action: "ticket.expired",
        entityType: "ticket",
        entityId: t.id,
        areaId: t.areaId,
        ticketId: t.id,
        subjectUserId: t.assigneeId,
        data: { dueAt: t.dueAt?.toISOString() ?? null },
      });
    }

    // 4) Talep hatırlatması.
    const reminderLimit = new Date(now.getTime() + (settings.managerResponseHours * 3_600_000) / 4);
    const remindCandidates = await tx
      .select({
        id: ticketRequests.id,
        kind: ticketRequests.kind,
        requesterId: ticketRequests.requesterId,
        respondBy: ticketRequests.respondBy,
        ticketId: tickets.id,
        ticketTitle: tickets.title,
        areaId: tickets.areaId,
      })
      .from(ticketRequests)
      .innerJoin(tickets, eq(tickets.id, ticketRequests.ticketId))
      .where(
        and(
          eq(ticketRequests.status, "pending"),
          isNull(ticketRequests.awaitingRequesterAt),
          isNull(ticketRequests.remindedAt),
          isNull(ticketRequests.overdueAt),
          gt(ticketRequests.respondBy, now),
          lte(ticketRequests.respondBy, reminderLimit),
        ),
      )
      .for("update", { of: ticketRequests, skipLocked: true });
    for (const r of remindCandidates) {
      if (requestReminderAt(r.respondBy, settings.managerResponseHours).getTime() > now.getTime()) continue;
      const [u] = await tx
        .update(ticketRequests)
        .set({ remindedAt: now })
        .where(
          and(
            eq(ticketRequests.id, r.id),
            eq(ticketRequests.status, "pending"),
            isNull(ticketRequests.remindedAt),
            isNull(ticketRequests.awaitingRequesterAt),
          ),
        )
        .returning({ id: ticketRequests.id });
      if (!u) continue;
      result.reminded++;
      await notify(tx, {
        userIds: await areaRecipients(tx, r.areaId, r.requesterId),
        type: "request_reminder",
        title: "Bekleyen talep cevap bekliyor",
        body: `"${r.ticketTitle}" için ${r.kind === "extension" ? "ek süre" : "geri çekme"} talebinin cevap süresi daralıyor.`,
        link: ticketLink(r.ticketId),
      });
      await audit(tx, {
        actorId: null,
        action: "request.reminded",
        entityType: "request",
        entityId: r.id,
        areaId: r.areaId,
        ticketId: r.ticketId,
        data: { respondBy: r.respondBy.toISOString() },
      });
    }

    // 5) Cevapsız talepler.
    const overdueCandidates = await tx
      .select({
        id: ticketRequests.id,
        kind: ticketRequests.kind,
        requesterId: ticketRequests.requesterId,
        respondBy: ticketRequests.respondBy,
        ticketId: tickets.id,
        ticketTitle: tickets.title,
        areaId: tickets.areaId,
      })
      .from(ticketRequests)
      .innerJoin(tickets, eq(tickets.id, ticketRequests.ticketId))
      .where(
        and(
          eq(ticketRequests.status, "pending"),
          isNull(ticketRequests.awaitingRequesterAt),
          isNull(ticketRequests.overdueAt),
          lte(ticketRequests.respondBy, now),
        ),
      )
      .for("update", { of: ticketRequests, skipLocked: true });
    for (const r of overdueCandidates) {
      const [u] = await tx
        .update(ticketRequests)
        .set({ overdueAt: now })
        .where(
          and(
            eq(ticketRequests.id, r.id),
            eq(ticketRequests.status, "pending"),
            isNull(ticketRequests.overdueAt),
            isNull(ticketRequests.awaitingRequesterAt),
          ),
        )
        .returning({ id: ticketRequests.id });
      if (!u) continue;
      result.overdue++;
      const recipients = [...(await areaRecipients(tx, r.areaId, r.requesterId)), ...(await mainAdminIds(tx, r.requesterId))];
      await notify(tx, {
        userIds: recipients,
        type: "request_overdue",
        title: "Cevapsız talep var",
        body: `"${r.ticketTitle}" için ${r.kind === "extension" ? "ek süre" : "geri çekme"} talebi süresinde cevaplanmadı.`,
        link: ticketLink(r.ticketId),
      });
      await audit(tx, {
        actorId: null,
        action: "request.overdue",
        entityType: "request",
        entityId: r.id,
        areaId: r.areaId,
        ticketId: r.ticketId,
        data: { respondBy: r.respondBy.toISOString() },
      });
    }

    return result;
  });
}
