import { z } from "zod";
import { AUDIT_ACTIONS, AUDIT_ACTION_GROUPS } from "@/lib/contracts/audit";
import type { AuditFilter } from "@/lib/contracts/admin";

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const KNOWN_ACTIONS = new Set<string>([...AUDIT_ACTIONS, ...AUDIT_ACTION_GROUPS.map((g) => g.value)]);

function pick(raw: Raw, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Sayfa ve CSV route'unun ortak sorgu ayrıştırıcısı. Geçersiz değerler yok sayılır. */
export function parseAuditSearchParams(raw: Raw): AuditFilter {
  const out: AuditFilter = {};
  const kisi = pick(raw, "kisi");
  if (kisi && uuid.safeParse(kisi).success) out.personId = kisi;
  const alan = pick(raw, "alan");
  if (alan && uuid.safeParse(alan).success) out.areaId = alan;
  const ticket = pick(raw, "ticket")?.trim();
  if (ticket && uuid.safeParse(ticket).success) out.ticketId = ticket;
  const eylem = pick(raw, "eylem");
  if (eylem && KNOWN_ACTIONS.has(eylem)) out.action = eylem;
  const bas = pick(raw, "bas");
  if (bas && isoDate.safeParse(bas).success && !Number.isNaN(Date.parse(bas))) out.from = bas;
  const bit = pick(raw, "bit");
  if (bit && isoDate.safeParse(bit).success && !Number.isNaN(Date.parse(bit))) out.to = bit;
  return out;
}

/** Filtreyi URL sorgusuna çevirir (cursor hariç). */
export function auditFilterToQuery(f: AuditFilter): string {
  const p = new URLSearchParams();
  if (f.personId) p.set("kisi", f.personId);
  if (f.areaId) p.set("alan", f.areaId);
  if (f.ticketId) p.set("ticket", f.ticketId);
  if (f.action) p.set("eylem", f.action);
  if (f.from) p.set("bas", f.from);
  if (f.to) p.set("bit", f.to);
  return p.toString();
}
