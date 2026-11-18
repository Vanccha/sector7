/** Ticket bağımlılıkları: ekleme/kaldırma (döngü kontrollü), ön koşul yükleme, alınabilirlik koşulu. */
import { and, asc, eq, ilike, inArray, ne, notInArray, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import type { DB } from "@/db";
import { areas, ticketDependencies, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/contracts/actor";
import { conflict, invalidState, notFound } from "@/lib/contracts/errors";
import {
  dependencySchema,
  isTicketEditable,
  POOL_STATUSES,
  PREREQ_DONE_STATUSES,
  searchPrereqSchema,
  type TicketRef,
} from "@/lib/contracts/plan";
import { assertSprintOpen, getSprintOrThrow, requireAreaEditor } from "./plan-common";

const refColumns = {
  id: tickets.id,
  title: tickets.title,
  areaId: tickets.areaId,
  areaName: areas.name,
  status: tickets.status,
};

const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/**
 * "Havuzda ve tüm ön koşulları bitmiş" koşulu (sorguda `tickets` tablosu olmalı).
 * Aşama 3'teki rastgele çekme de bunu kullanır.
 */
export function takeableCondition(): SQL {
  return sql`(${tickets.status}::text in (${list(POOL_STATUSES)}) and not exists (
    select 1 from ticket_dependencies td
    join tickets pt on pt.id = td.depends_on_id
    where td.ticket_id = ${tickets.id} and pt.status::text not in (${list(PREREQ_DONE_STATUSES)})
  ))`;
}

export async function loadPrerequisites(db: DbOrTx, ticketIds: string[]): Promise<Map<string, TicketRef[]>> {
  const map = new Map<string, TicketRef[]>();
  if (ticketIds.length === 0) return map;
  const rows = await db
    .select({ waiting: ticketDependencies.ticketId, ...refColumns })
    .from(ticketDependencies)
    .innerJoin(tickets, eq(tickets.id, ticketDependencies.dependsOnId))
    .innerJoin(areas, eq(areas.id, tickets.areaId))
    .where(inArray(ticketDependencies.ticketId, ticketIds))
    .orderBy(asc(areas.name), asc(tickets.title));
  for (const { waiting, ...ref } of rows) {
    const arr = map.get(waiting) ?? [];
    arr.push(ref);
    map.set(waiting, arr);
  }
  return map;
}

async function loadTicket(tx: DbOrTx, ticketId: string) {
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!t) throw notFound("Ticket bulunamadı.");
  return t;
}

/** Bekleyen ticket'ın bağlantıları değiştirilebilir mi: yetki, düzenlenebilir durum, açık sprint. */
async function requireEditableWaiting(tx: DbOrTx, actor: Actor | null, ticketId: string) {
  const waiting = await loadTicket(tx, ticketId);
  const { actor: a } = await requireAreaEditor(tx, actor, waiting.areaId);
  if (!isTicketEditable(waiting.status)) throw invalidState("Bu ticket'ın bağlantıları artık değiştirilemez.");
  assertSprintOpen(await getSprintOrThrow(tx, waiting.sprintId));
  return { waiting, a };
}

export async function addDependency(db: DB, actor: Actor | null, raw: { ticketId: string; dependsOnId: string }) {
  const input = dependencySchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ticket_dependencies'))`);
    const { waiting, a } = await requireEditableWaiting(tx, actor, input.ticketId);
    const pre = await loadTicket(tx, input.dependsOnId);
    if (pre.status === "cancelled") throw invalidState("İptal edilmiş ticket ön koşul olamaz.");

    const [existing] = await tx
      .select({ id: ticketDependencies.ticketId })
      .from(ticketDependencies)
      .where(
        and(eq(ticketDependencies.ticketId, input.ticketId), eq(ticketDependencies.dependsOnId, input.dependsOnId)),
      )
      .limit(1);
    if (existing) return;

    const cycle = await tx.execute(sql`
      with recursive reach(id) as (
        select ${input.dependsOnId}::uuid
        union
        select d.depends_on_id from ticket_dependencies d join reach r on d.ticket_id = r.id
      )
      select 1 as hit from reach where id = ${input.ticketId}::uuid limit 1`);
    if (cycle.rows.length > 0) {
      throw conflict("Bu bağlantı döngü oluşturur: ön koşul zaten bu ticket'ı bekliyor.");
    }

    await tx.insert(ticketDependencies).values({ ticketId: input.ticketId, dependsOnId: input.dependsOnId });
    await audit(tx, {
      actorId: a.id,
      action: "ticket.dependency_add",
      entityType: "ticket",
      entityId: input.ticketId,
      areaId: waiting.areaId,
      ticketId: input.ticketId,
      data: { dependsOnId: input.dependsOnId },
    });
  });
}

export async function removeDependency(db: DB, actor: Actor | null, raw: { ticketId: string; dependsOnId: string }) {
  const input = dependencySchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ticket_dependencies'))`);
    const { waiting, a } = await requireEditableWaiting(tx, actor, input.ticketId);
    const removed = await tx
      .delete(ticketDependencies)
      .where(
        and(eq(ticketDependencies.ticketId, input.ticketId), eq(ticketDependencies.dependsOnId, input.dependsOnId)),
      )
      .returning({ id: ticketDependencies.ticketId });
    if (removed.length === 0) return;
    await audit(tx, {
      actorId: a.id,
      action: "ticket.dependency_remove",
      entityType: "ticket",
      entityId: input.ticketId,
      areaId: waiting.areaId,
      ticketId: input.ticketId,
      data: { dependsOnId: input.dependsOnId },
    });
  });
}

/** Bağlanabilecek ön koşul adayları (tüm alanlardan, en fazla 20). */
export async function searchPrereqCandidates(
  db: DB,
  actor: Actor | null,
  raw: { ticketId: string; query?: string },
): Promise<TicketRef[]> {
  const input = searchPrereqSchema.parse(raw);
  const waiting = await loadTicket(db, input.ticketId);
  await requireAreaEditor(db, actor, waiting.areaId);
  const already = (
    await db
      .select({ id: ticketDependencies.dependsOnId })
      .from(ticketDependencies)
      .where(eq(ticketDependencies.ticketId, input.ticketId))
  ).map((r) => r.id);
  const escaped = input.query.replace(/[\\%_]/g, "\\$&");
  return db
    .select(refColumns)
    .from(tickets)
    .innerJoin(areas, eq(areas.id, tickets.areaId))
    .where(
      and(
        ne(tickets.status, "cancelled"),
        ne(tickets.id, input.ticketId),
        already.length ? notInArray(tickets.id, already) : undefined,
        input.query ? ilike(tickets.title, `%${escaped}%`) : undefined,
      ),
    )
    .orderBy(asc(areas.name), asc(tickets.title))
    .limit(20);
}
