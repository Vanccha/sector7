/** Denetim kaydı servisleri (yalnız ana yönetici). Okuma yapar; denetim kaydı yazmaz. */
import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { areas, auditLog, messages, tickets, user } from "@/db/schema";
import { requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_GROUPS,
  AUDIT_ACTION_LABELS,
} from "@/lib/contracts/audit";
import {
  AUDIT_CSV_MAX_ROWS,
  AUDIT_PAGE_SIZE,
  auditFilterSchema,
  type AuditFilter,
  type AuditFilterOptions,
  type AuditPage,
  type AuditRow,
} from "@/lib/contracts/admin";
import type { UserOption } from "@/lib/contracts/plan";
import { APP_TIMEZONE } from "@/lib/contracts/settings";

type ParsedFilter = ReturnType<typeof auditFilterSchema.parse>;
type LogRow = typeof auditLog.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

function buildWhere(f: ParsedFilter, withCursor: boolean): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.personId) conds.push(or(eq(auditLog.actorId, f.personId), eq(auditLog.subjectUserId, f.personId)));
  if (f.areaId) conds.push(eq(auditLog.areaId, f.areaId));
  if (f.ticketId) conds.push(eq(auditLog.ticketId, f.ticketId));
  if (f.action) {
    conds.push(
      f.action.endsWith(".")
        ? sql`${auditLog.action} LIKE ${escapeLike(f.action) + "%"}`
        : eq(auditLog.action, f.action),
    );
  }
  if (f.from) {
    conds.push(sql`${auditLog.createdAt} >= ((${f.from}::text)::date)::timestamp AT TIME ZONE ${APP_TIMEZONE}::text`);
  }
  if (f.to) {
    conds.push(sql`${auditLog.createdAt} < (((${f.to}::text)::date + 1))::timestamp AT TIME ZONE ${APP_TIMEZONE}::text`);
  }
  if (withCursor && f.cursor) conds.push(lt(auditLog.id, f.cursor));
  const real = conds.filter((c): c is SQL => !!c);
  return real.length ? and(...real) : undefined;
}

function messageIdOf(r: LogRow): string | null {
  if (r.entityType === "message") return r.entityId && UUID_RE.test(r.entityId) ? r.entityId : null;
  const m = r.data?.messageId;
  return typeof m === "string" && UUID_RE.test(m) ? m : null;
}

async function toAuditRows(db: DbOrTx, rows: LogRow[]): Promise<AuditRow[]> {
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.flatMap((r) => [r.actorId, r.subjectUserId]).filter((x): x is string => !!x))];
  const areaIds = [...new Set(rows.map((r) => r.areaId).filter((x): x is string => !!x))];
  const ticketIds = [...new Set(rows.map((r) => r.ticketId).filter((x): x is string => !!x))];
  const messageIds = [...new Set(rows.map(messageIdOf).filter((x): x is string => !!x))];

  const [userRows, areaRows, ticketRows, messageRows] = await Promise.all([
    userIds.length
      ? db.select({ id: user.id, name: user.name, username: user.username }).from(user).where(inArray(user.id, userIds))
      : [],
    areaIds.length ? db.select({ id: areas.id, name: areas.name }).from(areas).where(inArray(areas.id, areaIds)) : [],
    ticketIds.length
      ? db.select({ id: tickets.id, title: tickets.title }).from(tickets).where(inArray(tickets.id, ticketIds))
      : [],
    messageIds.length
      ? db.select({ id: messages.id, body: messages.body }).from(messages).where(inArray(messages.id, messageIds))
      : [],
  ]);
  const users = new Map<string, UserOption>(userRows.map((u) => [u.id, { id: u.id, name: u.name, username: u.username ?? "" }]));
  const areaMap = new Map(areaRows.map((a) => [a.id, a]));
  const ticketMap = new Map(ticketRows.map((t) => [t.id, t]));
  const bodies = new Map(messageRows.map((m) => [m.id, m.body]));

  return rows.map((r) => {
    const mid = messageIdOf(r);
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      actionLabel: (AUDIT_ACTION_LABELS as Record<string, string>)[r.action] ?? r.action,
      actor: r.actorId ? (users.get(r.actorId) ?? null) : null,
      entityType: r.entityType,
      entityId: r.entityId,
      area: r.areaId ? (areaMap.get(r.areaId) ?? null) : null,
      ticket: r.ticketId ? (ticketMap.get(r.ticketId) ?? null) : null,
      subject: r.subjectUserId ? (users.get(r.subjectUserId) ?? null) : null,
      data: r.data ?? {},
      messageBody: mid ? (bodies.get(mid) ?? null) : null,
    };
  });
}

export async function listAuditLog(db: DB, actor: Actor | null, raw: AuditFilter = {}): Promise<AuditPage> {
  requireMainAdmin(actor);
  const f = auditFilterSchema.parse(raw);
  const rows = await db
    .select()
    .from(auditLog)
    .where(buildWhere(f, true))
    .orderBy(desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE + 1);
  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  return { rows: await toAuditRows(db, page), nextCursor: hasMore && last ? last.id : null };
}

const CSV_HEADER = [
  "id",
  "zaman",
  "eylem",
  "eylem_adı",
  "yapan",
  "yapan_kullanıcı_adı",
  "etkilenen",
  "alan",
  "ticket",
  "varlık_türü",
  "varlık_id",
  "mesaj",
  "veri",
];

/** RFC 4180 tırnaklama + formül enjeksiyonuna karşı önek. */
function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function auditLogCsv(db: DB, actor: Actor | null, raw: AuditFilter = {}): Promise<string> {
  requireMainAdmin(actor);
  const f = auditFilterSchema.parse(raw);
  const logRows = await db
    .select()
    .from(auditLog)
    .where(buildWhere(f, false))
    .orderBy(desc(auditLog.id))
    .limit(AUDIT_CSV_MAX_ROWS);
  const rows = await toAuditRows(db, logRows);
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.createdAt,
        r.action,
        r.actionLabel,
        r.actor?.name ?? "",
        r.actor?.username ?? "",
        r.subject?.name ?? "",
        r.area?.name ?? "",
        r.ticket?.title ?? "",
        r.entityType,
        r.entityId,
        r.messageBody,
        JSON.stringify(r.data),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export async function getAuditFilterOptions(db: DB, actor: Actor | null): Promise<AuditFilterOptions> {
  requireMainAdmin(actor);
  const [people, areaRows] = await Promise.all([
    db.select({ id: user.id, name: user.name, username: user.username }).from(user).orderBy(user.name),
    db.select({ id: areas.id, name: areas.name }).from(areas).orderBy(areas.name),
  ]);
  return {
    people: people.map((p) => ({ id: p.id, name: p.name, username: p.username ?? "" })),
    areas: areaRows,
    actionGroups: AUDIT_ACTION_GROUPS,
    actions: AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] })),
  };
}
