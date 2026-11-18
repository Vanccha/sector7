import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { channels, messages, session, ticketRequests, tickets, user } from "../../src/db/schema";
import { loadActor } from "../../src/lib/auth/guards";
import {
  issueResetLinkFor,
  listUsers,
  reclaimTicket,
  revealPersonalData,
  setHomeArea,
  setMainAdminFor,
  setUserActive,
} from "../../src/server/users";
import { db, makeActiveSprint, makeActor, makeArea, makeMainAdmin, makeUser, resetDb } from "../helpers/db";
import { T0, at, H, makeMember, setupCycle, takenTicket, ticketById, type Cycle } from "../helpers/cycle";
import { expectMainAdminOnly, insertRequest, insertSubmission } from "../helpers/admin";
import { expectCode } from "../helpers/errors";
import { auditRows, makeTicketRow } from "../helpers/plan";

beforeEach(resetDb);

const uuid0 = "00000000-0000-4000-8000-000000000000";

async function addSession(userId: string) {
  await db.insert(session).values({
    token: `tok_${userId}_${Math.random()}`,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}
const sessionsOf = async (userId: string) => db.select().from(session).where(eq(session.userId, userId));
const deactivate = (id: string) => db.update(user).set({ active: false }).where(eq(user.id, id));

describe("üye yönetimi: yetki", () => {
  it("listUsers, revealPersonalData, setHomeArea, setUserActive, setMainAdminFor, issueResetLinkFor yalnız ana yönetici", async () => {
    const c = await setupCycle();
    const target = c.member.id;
    await expectMainAdminOnly(c, (a) => listUsers(db, a, {}));
    await expectMainAdminOnly(c, (a) => revealPersonalData(db, a, { userId: target }));
    await expectMainAdminOnly(c, (a) => setHomeArea(db, a, { userId: target, areaId: null }));
    await expectMainAdminOnly(c, (a) => setUserActive(db, a, { userId: target, active: false }));
    await expectMainAdminOnly(c, (a) => setMainAdminFor(db, a, { userId: target, value: true }));
    await expectMainAdminOnly(c, (a) => issueResetLinkFor(db, a, { userId: target }));
    // Reddedilenler hiçbir şeyi değiştirmedi.
    const [u] = await db.select().from(user).where(eq(user.id, target));
    expect(u!.active).toBe(true);
    expect(u!.isMainAdmin).toBe(false);
  });
});

describe("listUsers", () => {
  it("kişisel veri (e-posta/telefon) içermez", async () => {
    const c = await setupCycle();
    await db.update(user).set({ phone: "05551112233" }).where(eq(user.id, c.member.id));
    const rows = await listUsers(db, c.admin, {});
    const json = JSON.stringify(rows);
    expect(json).not.toContain("@example.com");
    expect(json).not.toContain("05551112233");
    for (const r of rows) {
      expect(r).not.toHaveProperty("email");
      expect(r).not.toHaveProperty("phone");
    }
  });

  it("ad ya da kullanıcı adıyla arar (büyük/küçük harf duyarsız)", async () => {
    const c = await setupCycle();
    await makeUser({ name: "Zeynep Kaya", username: "zkaya" });
    await makeUser({ name: "Mehmet Demir", username: "mdemir" });
    expect((await listUsers(db, c.admin, { query: "zeynep" })).map((r) => r.username)).toEqual(["zkaya"]);
    expect((await listUsers(db, c.admin, { query: "MDEMIR" })).map((r) => r.name)).toEqual(["Mehmet Demir"]);
    expect(await listUsers(db, c.admin, { query: "yokboyle" })).toEqual([]);
  });

  it("% ve _ joker sayılmaz", async () => {
    const c = await setupCycle();
    await makeUser({ name: "Yüzde 100%", username: "yuzde" });
    await makeUser({ name: "Alt_çizgi", username: "altcizgi" });
    await makeUser({ name: "AltXçizgi", username: "duzkisi" });
    expect((await listUsers(db, c.admin, { query: "%" })).map((r) => r.username)).toEqual(["yuzde"]);
    expect((await listUsers(db, c.admin, { query: "t_ç" })).map((r) => r.username)).toEqual(["altcizgi"]);
  });

  it("status süzmesi: all / active / inactive", async () => {
    const c = await setupCycle();
    const ghost = await makeUser({ name: "Pasif", active: false });
    const all = (await listUsers(db, c.admin, { status: "all" })).map((r) => r.id);
    const act = (await listUsers(db, c.admin, { status: "active" })).map((r) => r.id);
    const inact = (await listUsers(db, c.admin, { status: "inactive" })).map((r) => r.id);
    expect(all).toContain(ghost.id);
    expect(act).not.toContain(ghost.id);
    expect(act).toContain(c.member.id);
    expect(inact).toEqual([ghost.id]);
  });

  it("heldTickets: teklif + sürmekte olanlar; submitted/evaluated sayılmaz", async () => {
    const c = await setupCycle();
    const m = c.member;
    const mkT = (status: string, extra: Record<string, unknown> = {}) =>
      makeTicketRow({ areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: status as never, assigneeId: m.id, ...extra });
    await mkT("offered", { offeredAt: T0 });
    await mkT("taken");
    await mkT("extension_pending");
    await mkT("withdrawal_pending");
    await mkT("submitted");
    await mkT("evaluated");
    const row = (await listUsers(db, c.admin, {})).find((r) => r.id === m.id)!;
    expect(row.heldTickets).toBe(4);
    const other = (await listUsers(db, c.admin, {})).find((r) => r.id === c.mgrA.id)!;
    expect(other.heldTickets).toBe(0);
  });

  it("submittedThisSprint: aktif sprintte teslim edilen ticket sayısı (tekrar teslim tek sayılır, eski sprint sayılmaz)", async () => {
    const c = await setupCycle();
    const t1 = await makeTicketRow({ areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "submitted", assigneeId: c.member.id });
    const t2 = await makeTicketRow({ areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "evaluated", assigneeId: c.member.id });
    await insertSubmission({ ticketId: t1.id, userId: c.member.id });
    await insertSubmission({ ticketId: t1.id, userId: c.member.id });
    await insertSubmission({ ticketId: t2.id, userId: c.member.id });
    const old = await makeActiveSprint({ number: 2, name: "Eski", status: "closed", startDate: "2026-10-01" });
    const t3 = await makeTicketRow({ areaId: c.areaA.id, sprintId: old.id, createdById: c.admin.id, status: "evaluated", assigneeId: c.member.id });
    await insertSubmission({ ticketId: t3.id, userId: c.member.id });
    const rows = await listUsers(db, c.admin, {});
    expect(rows.find((r) => r.id === c.member.id)!.submittedThisSprint).toBe(2);
    expect(rows.find((r) => r.id === c.mgrA.id)!.submittedThisSprint).toBe(0);
  });

  it("homeArea, managedAreas, isMainAdmin, active alanları", async () => {
    const c = await setupCycle();
    const rows = await listUsers(db, c.admin, {});
    const m = rows.find((r) => r.id === c.member.id)!;
    expect(m.homeArea).toEqual({ id: c.home.id, name: c.home.name });
    expect(m.managedAreas).toEqual([]);
    expect(m.isMainAdmin).toBe(false);
    expect(m.active).toBe(true);
    const mg = rows.find((r) => r.id === c.mgrA.id)!;
    expect(mg.managedAreas).toEqual([{ id: c.areaA.id, name: c.areaA.name }]);
    expect(rows.find((r) => r.id === c.admin.id)!.isMainAdmin).toBe(true);
  });
});

describe("revealPersonalData", () => {
  it("e-posta ve telefonu döndürür; her çağrı personal_data.view kaydı yazar (subjectUserId)", async () => {
    const c = await setupCycle();
    const u = await makeUser({ email: "gizli@example.com", phone: "05320001122" });
    const r = await revealPersonalData(db, c.admin, { userId: u.id });
    expect(r).toEqual({ userId: u.id, email: "gizli@example.com", phone: "05320001122" });
    await revealPersonalData(db, c.admin, { userId: u.id });
    const rows = await auditRows("personal_data.view");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actorId: c.admin.id, subjectUserId: u.id });
  });

  it("olmayan kişi NOT_FOUND ve kayıt yazmaz", async () => {
    const c = await setupCycle();
    await expectCode(() => revealPersonalData(db, c.admin, { userId: uuid0 }), "NOT_FOUND");
    expect(await auditRows("personal_data.view")).toHaveLength(0);
  });
});

describe("setHomeArea", () => {
  it("alan değiştirir ve user.set_home_area kaydı yazar (from/to)", async () => {
    const c = await setupCycle();
    await setHomeArea(db, c.admin, { userId: c.member.id, areaId: c.areaB.id });
    const [u] = await db.select().from(user).where(eq(user.id, c.member.id));
    expect(u!.homeAreaId).toBe(c.areaB.id);
    const rows = await auditRows("user.set_home_area");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: c.admin.id, subjectUserId: c.member.id });
    expect(rows[0]!.data).toMatchObject({ from: c.home.id, to: c.areaB.id });
  });

  it("null kabul edilir (ana alan kaldırılır)", async () => {
    const c = await setupCycle();
    await setHomeArea(db, c.admin, { userId: c.member.id, areaId: null });
    const [u] = await db.select().from(user).where(eq(user.id, c.member.id));
    expect(u!.homeAreaId).toBeNull();
    expect(await auditRows("user.set_home_area")).toHaveLength(1);
  });

  it("değişmezse kayıt yazılmaz", async () => {
    const c = await setupCycle();
    await setHomeArea(db, c.admin, { userId: c.member.id, areaId: c.home.id });
    expect(await auditRows("user.set_home_area")).toHaveLength(0);
  });

  it("arşivli alan VALIDATION, olmayan alan/kişi NOT_FOUND", async () => {
    const c = await setupCycle();
    const arch = await makeArea({ archivedAt: new Date() });
    await expectCode(() => setHomeArea(db, c.admin, { userId: c.member.id, areaId: arch.id }), "VALIDATION");
    await expectCode(() => setHomeArea(db, c.admin, { userId: c.member.id, areaId: uuid0 }), "NOT_FOUND");
    await expectCode(() => setHomeArea(db, c.admin, { userId: uuid0, areaId: c.areaA.id }), "NOT_FOUND");
    const [u] = await db.select().from(user).where(eq(user.id, c.member.id));
    expect(u!.homeAreaId).toBe(c.home.id);
  });
});

describe("setUserActive", () => {
  it("kendini pasifleştiremez (INVALID_STATE)", async () => {
    const c = await setupCycle();
    await expectCode(() => setUserActive(db, c.admin, { userId: c.admin.id, active: false }), "INVALID_STATE");
    expect(await loadActor(db, c.admin.id)).not.toBeNull();
  });

  it("son aktif ana yönetici pasifleştirilemez (INVALID_STATE)", async () => {
    const c = await setupCycle();
    const second = await makeMainAdmin();
    await setUserActive(db, c.admin, { userId: second.id, active: false });
    // `second` artık pasif; elindeki eski actor nesnesiyle son aktif ana yöneticiyi pasifleştirmeye çalışır.
    await expectCode(() => setUserActive(db, second, { userId: c.admin.id, active: false }), "INVALID_STATE");
    expect(await loadActor(db, c.admin.id)).not.toBeNull();
  });

  it("pasifleştirince oturumlar silinir, loadActor null, user.deactivate kaydı; başkasının oturumu kalır", async () => {
    const c = await setupCycle();
    await addSession(c.member.id);
    await addSession(c.member.id);
    await addSession(c.mgrA.id);
    await setUserActive(db, c.admin, { userId: c.member.id, active: false });
    expect(await sessionsOf(c.member.id)).toHaveLength(0);
    expect(await sessionsOf(c.mgrA.id)).toHaveLength(1);
    expect(await loadActor(db, c.member.id)).toBeNull();
    const rows = await auditRows("user.deactivate");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: c.admin.id, subjectUserId: c.member.id });
  });

  it("kişinin ticket'larına dokunulmaz (durum, kişi, süre aynı)", async () => {
    const c = await setupCycle();
    const taken = await takenTicket(c, c.areaA.id, c.member);
    const offered = await makeTicketRow({
      areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "offered", assigneeId: c.member.id, offeredAt: T0,
    });
    await insertRequest({ ticketId: taken.id, requesterId: c.member.id });
    await setUserActive(db, c.admin, { userId: c.member.id, active: false });
    for (const before of [taken, offered]) {
      const after = await ticketById(before.id);
      expect(after.status).toBe(before.status);
      expect(after.assigneeId).toBe(c.member.id);
      expect(after.dueAt).toEqual(before.dueAt);
      expect(after.offeredAt).toEqual(before.offeredAt);
    }
    const [req] = await db.select().from(ticketRequests).where(eq(ticketRequests.ticketId, taken.id));
    expect(req!.status).toBe("pending");
    const rec = (await auditRows("user.deactivate"))[0]!;
    expect(rec.data).toMatchObject({ heldTickets: 2 });
  });

  it("etkinleştirme: loadActor tekrar döner, user.activate kaydı", async () => {
    const c = await setupCycle();
    await setUserActive(db, c.admin, { userId: c.member.id, active: false });
    await setUserActive(db, c.admin, { userId: c.member.id, active: true });
    expect(await loadActor(db, c.member.id)).not.toBeNull();
    expect(await auditRows("user.activate")).toHaveLength(1);
  });

  it("durum değişmezse kayıt yazılmaz", async () => {
    const c = await setupCycle();
    await setUserActive(db, c.admin, { userId: c.member.id, active: true });
    expect(await auditRows("user.activate")).toHaveLength(0);
    await setUserActive(db, c.admin, { userId: c.member.id, active: false });
    await setUserActive(db, c.admin, { userId: c.member.id, active: false });
    expect(await auditRows("user.deactivate")).toHaveLength(1);
  });

  it("olmayan kişi NOT_FOUND", async () => {
    const c = await setupCycle();
    await expectCode(() => setUserActive(db, c.admin, { userId: uuid0, active: false }), "NOT_FOUND");
  });

  it("eşzamanlı iki ana yönetici birbirini pasifleştirince en az bir aktif ana yönetici kalır", async () => {
    for (let i = 0; i < 6; i++) {
      await resetDb();
      const a = await makeMainAdmin();
      const b = await makeMainAdmin();
      const res = await Promise.allSettled([
        setUserActive(db, a, { userId: b.id, active: false }),
        setUserActive(db, b, { userId: a.id, active: false }),
      ]);
      const rows = await db.select().from(user).where(and(eq(user.isMainAdmin, true), eq(user.active, true)));
      expect(rows.length, `tur ${i}: ${JSON.stringify(res.map((r) => r.status))}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("reclaimTicket", () => {
  async function ghostSetup() {
    const c = await setupCycle();
    const ghost = await makeMember(c.home.id, "Giden");
    const t = await takenTicket(c, c.areaA.id, ghost);
    await deactivate(ghost.id);
    return { c, ghost, t };
  }

  it("oturumsuz UNAUTHENTICATED", async () => {
    const { t } = await ghostSetup();
    await expectCode(() => reclaimTicket(db, null, { ticketId: t.id }), "UNAUTHENTICATED");
  });

  it("alan yöneticisi geri alabilir: havuza döner, kişi/süre temizlenir, talep iptal, sistem mesajı, ticket.reclaim kaydı", async () => {
    const { c, ghost, t } = await ghostSetup();
    const req = await insertRequest({ ticketId: t.id, requesterId: ghost.id });
    await db.update(tickets).set({ status: "extension_pending", pausedAt: at(-H) }).where(eq(tickets.id, t.id));
    await reclaimTicket(db, c.mgrA, { ticketId: t.id }, at(H));
    const after = await ticketById(t.id);
    expect(after.status).toBe("returned_to_pool");
    expect(after.assigneeId).toBeNull();
    expect(after.dueAt).toBeNull();
    expect(after.takenAt).toBeNull();
    expect(after.pausedAt).toBeNull();
    const [r] = await db.select().from(ticketRequests).where(eq(ticketRequests.id, req.id));
    expect(r!.status).toBe("cancelled");
    const [ch] = await db.select().from(channels).where(and(eq(channels.kind, "ticket"), eq(channels.ticketId, t.id)));
    expect(ch).toBeTruthy();
    const msgs = await db.select().from(messages).where(eq(messages.channelId, ch!.id));
    const sys = msgs.filter((m) => m.kind === "system");
    expect(sys).toHaveLength(1);
    expect(sys[0]!.authorId).toBeNull();
    const log = await auditRows("ticket.reclaim");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: c.mgrA.id, ticketId: t.id, areaId: c.areaA.id, subjectUserId: ghost.id });
  });

  it("ana yönetici de geri alabilir; pasif kişide teklif (offered) de havuza döner", async () => {
    const c = await setupCycle();
    const ghost = await makeMember(c.home.id, "Giden");
    const t = await makeTicketRow({
      areaId: c.areaB.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "offered", assigneeId: ghost.id, offeredAt: T0,
    });
    await deactivate(ghost.id);
    await reclaimTicket(db, c.admin, { ticketId: t.id });
    const after = await ticketById(t.id);
    expect(after.status).toBe("returned_to_pool");
    expect(after.assigneeId).toBeNull();
    expect(after.offeredAt).toBeNull();
  });

  it("başka alanın yöneticisi ve sıradan üye FORBIDDEN; ticket değişmez", async () => {
    const { c, t } = await ghostSetup();
    await expectCode(() => reclaimTicket(db, c.mgrB, { ticketId: t.id }), "FORBIDDEN");
    await expectCode(() => reclaimTicket(db, c.member, { ticketId: t.id }), "FORBIDDEN");
    expect((await ticketById(t.id)).status).toBe("taken");
    expect(await auditRows("ticket.reclaim")).toHaveLength(0);
  });

  it("kişi aktifse INVALID_STATE", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await expectCode(() => reclaimTicket(db, c.mgrA, { ticketId: t.id }), "INVALID_STATE");
    await expectCode(() => reclaimTicket(db, c.admin, { ticketId: t.id }), "INVALID_STATE");
    expect((await ticketById(t.id)).assigneeId).toBe(c.member.id);
  });

  it("pasif kişide submitted ticket INVALID_STATE; kişisiz (havuzdaki) ticket INVALID_STATE", async () => {
    const { c, ghost } = await ghostSetup();
    const sub = await makeTicketRow({
      areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "submitted", assigneeId: ghost.id,
    });
    const pool = await makeTicketRow({ areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "available" });
    await expectCode(() => reclaimTicket(db, c.mgrA, { ticketId: sub.id }), "INVALID_STATE");
    await expectCode(() => reclaimTicket(db, c.mgrA, { ticketId: pool.id }), "INVALID_STATE");
    expect((await ticketById(sub.id)).status).toBe("submitted");
  });

  it("olmayan ticket NOT_FOUND", async () => {
    const c = await setupCycle();
    await expectCode(() => reclaimTicket(db, c.admin, { ticketId: uuid0 }), "NOT_FOUND");
  });
});

describe("setMainAdminFor ve issueResetLinkFor", () => {
  it("pasif kişiye ana yönetici verilemez (INVALID_STATE)", async () => {
    const c = await setupCycle();
    const ghost = await makeUser({ active: false });
    await expectCode(() => setMainAdminFor(db, c.admin, { userId: ghost.id, value: true }), "INVALID_STATE");
    const [u] = await db.select().from(user).where(eq(user.id, ghost.id));
    expect(u!.isMainAdmin).toBe(false);
  });

  it("aktife verilir/alınır ve kayıt yazılır; olmayan kişi NOT_FOUND", async () => {
    const c = await setupCycle();
    await setMainAdminFor(db, c.admin, { userId: c.member.id, value: true });
    expect((await loadActor(db, c.member.id))!.isMainAdmin).toBe(true);
    expect(await auditRows("user.grant_main_admin")).toHaveLength(1);
    await setMainAdminFor(db, c.admin, { userId: c.member.id, value: false });
    expect((await loadActor(db, c.member.id))!.isMainAdmin).toBe(false);
    const rev = await auditRows("user.revoke_main_admin");
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ actorId: c.admin.id, subjectUserId: c.member.id });
    await expectCode(() => setMainAdminFor(db, c.admin, { userId: uuid0, value: true }), "NOT_FOUND");
  });

  it("issueResetLinkFor { link, active } döner (aktif ve pasif kişi için) ve kayıt yazar", async () => {
    const c = await setupCycle();
    const ghost = await makeUser({ active: false });
    const a = await issueResetLinkFor(db, c.admin, { userId: c.member.id });
    expect(a.active).toBe(true);
    expect(typeof a.link.url).toBe("string");
    expect(a.link.token.length).toBeGreaterThan(10);
    expect(a.link.url).toContain(a.link.token);
    const b = await issueResetLinkFor(db, c.admin, { userId: ghost.id });
    expect(b.active).toBe(false);
    expect(b.link.token).not.toBe(a.link.token);
    expect(await auditRows("user.reset_link_issued")).toHaveLength(2);
    await expectCode(() => issueResetLinkFor(db, c.admin, { userId: uuid0 }), "NOT_FOUND");
  });
});

export type { Cycle };
void makeActor;
