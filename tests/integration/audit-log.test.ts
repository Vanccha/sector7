import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLog, user } from "../../src/db/schema";
import { AUDIT_ACTIONS, AUDIT_ACTION_GROUPS, AUDIT_ACTION_LABELS } from "../../src/lib/contracts/audit";
import { AUDIT_CSV_MAX_ROWS, AUDIT_PAGE_SIZE } from "../../src/lib/contracts/admin";
import { auditLogCsv, getAuditFilterOptions, listAuditLog } from "../../src/server/audit-log";
import { db, makeArea, makeUser, resetDb } from "../helpers/db";
import { setupCycle, takenTicket } from "../helpers/cycle";
import { expectMainAdminOnly, insertAudit } from "../helpers/admin";
import { addMessages, areaChannelId } from "../helpers/messaging";

beforeEach(resetDb);

/** Küçük RFC 4180 ayrıştırıcı (BOM ve başlık dahil tüm satırlar). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe("denetim kaydı: yetki", () => {
  it("listAuditLog, auditLogCsv, getAuditFilterOptions yalnız ana yöneticiye", async () => {
    const c = await setupCycle();
    await expectMainAdminOnly(c, (a) => listAuditLog(db, a, {}));
    await expectMainAdminOnly(c, (a) => auditLogCsv(db, a, {}));
    await expectMainAdminOnly(c, (a) => getAuditFilterOptions(db, a));
    await expect(listAuditLog(db, c.admin, {})).resolves.toBeTruthy();
  });
});

describe("listAuditLog: sıra ve sayfalama", () => {
  it("id azalan sırada; nextCursor ile sayfalanır, son sayfada null", async () => {
    const c = await setupCycle();
    const total = AUDIT_PAGE_SIZE * 2 + 20;
    await db.insert(auditLog).values(Array.from({ length: total }, (_, i) => ({ action: "ticket.create", entityType: "t", actorId: c.admin.id, entityId: String(i) })));
    const p1 = await listAuditLog(db, c.admin, {});
    expect(p1.rows).toHaveLength(AUDIT_PAGE_SIZE);
    const ids1 = p1.rows.map((r) => r.id);
    expect(ids1).toEqual([...ids1].sort((a, b) => b - a));
    expect(p1.nextCursor).toBe(ids1[ids1.length - 1]);
    const p2 = await listAuditLog(db, c.admin, { cursor: p1.nextCursor });
    expect(p2.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(p2.rows[0]!.id).toBeLessThan(ids1[ids1.length - 1]!);
    expect(p2.nextCursor).toBe(p2.rows[p2.rows.length - 1]!.id);
    const p3 = await listAuditLog(db, c.admin, { cursor: p2.nextCursor });
    expect(p3.rows).toHaveLength(20);
    expect(p3.nextCursor).toBeNull();
    const all = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id);
    expect(new Set(all).size).toBe(total);
  });

  it("tam sayfa kadar kayıtta nextCursor null; bir fazlasında dolu", async () => {
    const c = await setupCycle();
    await db.insert(auditLog).values(Array.from({ length: AUDIT_PAGE_SIZE }, () => ({ action: "ticket.create", entityType: "t" })));
    expect((await listAuditLog(db, c.admin, {})).nextCursor).toBeNull();
    await insertAudit({ action: "ticket.create" });
    const p = await listAuditLog(db, c.admin, {});
    expect(p.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(p.nextCursor).not.toBeNull();
  });

  it("kayıt yoksa boş sayfa", async () => {
    const c = await setupCycle();
    expect(await listAuditLog(db, c.admin, {})).toEqual({ rows: [], nextCursor: null });
  });
});

describe("listAuditLog: filtreler", () => {
  it("personId hem yapan hem etkilenen kayıtları getirir", async () => {
    const c = await setupCycle();
    const other = await makeUser();
    const asActor = await insertAudit({ action: "ticket.create", actorId: c.member.id });
    const asSubject = await insertAudit({ action: "user.activate", actorId: c.admin.id, subjectUserId: c.member.id });
    await insertAudit({ action: "ticket.create", actorId: other.id });
    await insertAudit({ action: "user.activate", actorId: c.admin.id, subjectUserId: other.id });
    const p = await listAuditLog(db, c.admin, { personId: c.member.id });
    expect(p.rows.map((r) => r.id).sort()).toEqual([asActor.id, asSubject.id].sort());
  });

  it("areaId ve ticketId", async () => {
    const c = await setupCycle();
    const t1 = await takenTicket(c, c.areaA.id, c.member);
    const t2 = await takenTicket(c, c.areaB.id, c.member);
    const r1 = await insertAudit({ action: "ticket.submit", areaId: c.areaA.id, ticketId: t1.id });
    const r2 = await insertAudit({ action: "ticket.submit", areaId: c.areaB.id, ticketId: t2.id });
    await insertAudit({ action: "settings.update" });
    expect((await listAuditLog(db, c.admin, { areaId: c.areaA.id })).rows.map((r) => r.id)).toEqual([r1.id]);
    expect((await listAuditLog(db, c.admin, { ticketId: t2.id })).rows.map((r) => r.id)).toEqual([r2.id]);
    const row = (await listAuditLog(db, c.admin, { ticketId: t1.id })).rows[0]!;
    expect(row.area).toEqual({ id: c.areaA.id, name: c.areaA.name });
    expect(row.ticket).toEqual({ id: t1.id, title: t1.title });
  });

  it("eylem: tam ad yalnız o eylemi, 'ticket.' öneki grubu getirir", async () => {
    const c = await setupCycle();
    const a = await insertAudit({ action: "ticket.submit" });
    const b = await insertAudit({ action: "ticket.create" });
    const r = await insertAudit({ action: "request.create" });
    const exact = await listAuditLog(db, c.admin, { action: "ticket.submit" });
    expect(exact.rows.map((x) => x.id)).toEqual([a.id]);
    const group = await listAuditLog(db, c.admin, { action: "ticket." });
    expect(group.rows.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(group.rows.map((x) => x.id)).not.toContain(r.id);
  });

  it("grup önekinde % ve _ joker sayılmaz", async () => {
    const c = await setupCycle();
    await insertAudit({ action: "ticket.create" });
    await insertAudit({ action: "request.create" });
    const lit = await insertAudit({ action: "x_y.create" });
    await insertAudit({ action: "xzy.create" });
    expect((await listAuditLog(db, c.admin, { action: "%." })).rows).toEqual([]);
    expect((await listAuditLog(db, c.admin, { action: "tick_t." })).rows).toEqual([]);
    expect((await listAuditLog(db, c.admin, { action: "x_y." })).rows.map((r) => r.id)).toEqual([lit.id]);
  });

  it("tarih aralığı Europe/Istanbul gününe göre; `to` dahil", async () => {
    const c = await setupCycle();
    const mk = (iso: string) => insertAudit({ action: "ticket.create", createdAt: new Date(iso) });
    const before = await mk("2026-11-17T20:59:59Z"); // 17 Kasım 23:59:59 (İstanbul)
    const start = await mk("2026-11-17T21:00:00Z"); // 18 Kasım 00:00
    const lateUtc = await mk("2026-11-17T21:30:00Z"); // UTC'de 17, İstanbul'da 18
    const end = await mk("2026-11-18T20:59:59Z"); // 18 Kasım 23:59:59
    const after = await mk("2026-11-18T21:00:00Z"); // 19 Kasım 00:00
    const ids = async (f: Parameters<typeof listAuditLog>[2]) => (await listAuditLog(db, c.admin, f)).rows.map((r) => r.id).sort((a, b) => a - b);
    expect(await ids({ from: "2026-11-18", to: "2026-11-18" })).toEqual([start.id, lateUtc.id, end.id]);
    expect(await ids({ to: "2026-11-17" })).toEqual([before.id]);
    expect(await ids({ from: "2026-11-19" })).toEqual([after.id]);
    expect(await ids({ from: "2026-11-18" })).toEqual([start.id, lateUtc.id, end.id, after.id]);
  });

  it("geçersiz tarih biçimi reddedilir", async () => {
    const c = await setupCycle();
    await expect(listAuditLog(db, c.admin, { from: "18.11.2026" })).rejects.toBeTruthy();
  });

  it("filtreler birlikte AND ile uygulanır", async () => {
    const c = await setupCycle();
    const hit = await insertAudit({ action: "ticket.submit", actorId: c.member.id, areaId: c.areaA.id });
    await insertAudit({ action: "ticket.submit", actorId: c.member.id, areaId: c.areaB.id });
    await insertAudit({ action: "request.create", actorId: c.member.id, areaId: c.areaA.id });
    const p = await listAuditLog(db, c.admin, { personId: c.member.id, areaId: c.areaA.id, action: "ticket." });
    expect(p.rows.map((r) => r.id)).toEqual([hit.id]);
  });
});

describe("listAuditLog: satır içeriği", () => {
  it("actor null → null (sistem); actionLabel bilinen için Türkçe etiket, bilinmeyen için eylem adı", async () => {
    const c = await setupCycle();
    await insertAudit({ action: "ticket.expired", actorId: null });
    await insertAudit({ action: "bilinmeyen.eylem", actorId: c.admin.id });
    const rows = (await listAuditLog(db, c.admin, {})).rows;
    const sys = rows.find((r) => r.action === "ticket.expired")!;
    expect(sys.actor).toBeNull();
    expect(sys.actionLabel).toBe(AUDIT_ACTION_LABELS["ticket.expired"]);
    const unk = rows.find((r) => r.action === "bilinmeyen.eylem")!;
    expect(unk.actionLabel).toBe("bilinmeyen.eylem");
    expect(unk.actor?.id).toBe(c.admin.id);
  });

  it("message.send ve request.message kayıtlarında mesaj metni; diğerlerinde null", async () => {
    const c = await setupCycle();
    const chId = await areaChannelId(c.areaA);
    const [m1, m2] = await addMessages(chId, 2, { authorId: c.member.id, prefix: "Merhaba dünya " });
    await insertAudit({ action: "message.send", actorId: c.member.id, entityType: "message", entityId: m1!.id, data: { channelId: chId, messageId: m1!.id } });
    await insertAudit({ action: "request.message", actorId: c.member.id, entityType: "ticket_request", entityId: null, data: { messageId: m2!.id } });
    await insertAudit({ action: "ticket.create", actorId: c.member.id });
    const rows = (await listAuditLog(db, c.admin, {})).rows;
    expect(rows.find((r) => r.action === "message.send")!.messageBody).toBe(m1!.body);
    expect(rows.find((r) => r.action === "request.message")!.messageBody).toBe(m2!.body);
    expect(rows.find((r) => r.action === "ticket.create")!.messageBody).toBeNull();
  });

  it("subject ve data döner", async () => {
    const c = await setupCycle();
    await insertAudit({ action: "user.deactivate", actorId: c.admin.id, subjectUserId: c.member.id, data: { heldTickets: 2 } });
    const row = (await listAuditLog(db, c.admin, {})).rows[0]!;
    expect(row.subject?.id).toBe(c.member.id);
    expect(row.data).toEqual({ heldTickets: 2 });
  });
});

describe("auditLogCsv", () => {
  it("UTF-8 BOM, başlık satırı, CRLF ve filtreleri uygular", async () => {
    const c = await setupCycle();
    await insertAudit({ action: "ticket.create", actorId: c.admin.id, areaId: c.areaA.id });
    await insertAudit({ action: "settings.update", actorId: c.admin.id });
    const csv = await auditLogCsv(db, c.admin, { action: "ticket." });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    const rows = parseCsv(csv.slice(1));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.slice(0, 5)).toEqual(["id", "zaman", "eylem", "eylem_adı", "yapan"]);
    expect(rows[1]![2]).toBe("ticket.create");
    expect(rows[1]![3]).toBe(AUDIT_ACTION_LABELS["ticket.create"]);
    expect(rows[1]![7]).toBe(c.areaA.name);
  });

  it("virgül, tırnak ve satır sonu içeren hücre tırnaklanır ve geri okunur", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member, { title: 'Ali, "Veli"\nsatır' });
    await insertAudit({ action: "ticket.create", ticketId: t.id });
    const csv = await auditLogCsv(db, c.admin, {});
    expect(csv).toContain('"Ali, ""Veli""\nsatır"');
    const rows = parseCsv(csv.slice(1));
    expect(rows).toHaveLength(2);
    expect(rows[1]![8]).toBe('Ali, "Veli"\nsatır');
    expect(rows[1]).toHaveLength(rows[0]!.length);
  });

  it("=, +, -, @ ile başlayan hücreler ' önekli", async () => {
    const c = await setupCycle();
    for (const title of ["=HYPERLINK(1)", "+1+1", "-2+3", "@SUM(A1)"]) {
      const t = await takenTicket(c, c.areaA.id, c.member, { title });
      await insertAudit({ action: "ticket.create", ticketId: t.id });
    }
    const rows = parseCsv((await auditLogCsv(db, c.admin, {})).slice(1)).slice(1);
    const titles = rows.map((r) => r[8]!).sort();
    expect(titles).toEqual(["'+1+1", "'-2+3", "'=HYPERLINK(1)", "'@SUM(A1)"].sort());
  });

  it("kullanıcı adı/ad alanındaki formül öneki de kaçışlanır", async () => {
    const c = await setupCycle();
    const evil = await makeUser({ name: "=cmd|' /C calc'!A0", username: "evil1" });
    await insertAudit({ action: "ticket.create", actorId: evil.id });
    const rows = parseCsv((await auditLogCsv(db, c.admin, {})).slice(1));
    expect(rows[1]![4]!.startsWith("'=")).toBe(true);
  });

  it(`en fazla AUDIT_CSV_MAX_ROWS (${AUDIT_CSV_MAX_ROWS}) satır; en yeniler`, async () => {
    const c = await setupCycle();
    await db.execute(
      sql`INSERT INTO audit_log (action, entity_type, entity_id) SELECT 'ticket.create', 't', g::text FROM generate_series(1, ${AUDIT_CSV_MAX_ROWS + 5}) g`,
    );
    const rows = parseCsv((await auditLogCsv(db, c.admin, {})).slice(1));
    expect(rows).toHaveLength(AUDIT_CSV_MAX_ROWS + 1);
    expect(rows[1]![10]).toBe(String(AUDIT_CSV_MAX_ROWS + 5));
  }, 60_000);
});

describe("getAuditFilterOptions", () => {
  it("pasif kişileri ve arşivli alanları da içerir; eylem ve grup listeleri", async () => {
    const c = await setupCycle();
    const ghost = await makeUser({ name: "Pasif Kişi", active: false });
    const arch = await makeArea({ name: "Arşivli Alan", archivedAt: new Date() });
    const o = await getAuditFilterOptions(db, c.admin);
    expect(o.people.map((p) => p.id)).toContain(ghost.id);
    expect(o.people.map((p) => p.id)).toContain(c.member.id);
    expect(o.areas.map((a) => a.id)).toContain(arch.id);
    expect(o.areas.map((a) => a.id)).toContain(c.areaA.id);
    expect(o.actionGroups).toEqual(AUDIT_ACTION_GROUPS);
    expect(o.actions.map((a) => a.value)).toEqual([...AUDIT_ACTIONS]);
    expect(o.actions.find((a) => a.value === "user.deactivate")!.label).toBe(AUDIT_ACTION_LABELS["user.deactivate"]);
  });

  it("kayıtlardaki silinmiş değil, mevcut kullanıcı sayısı kadar kişi", async () => {
    const c = await setupCycle();
    const o = await getAuditFilterOptions(db, c.admin);
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(user);
    expect(o.people).toHaveLength(n!.n);
    void eq;
  });
});
