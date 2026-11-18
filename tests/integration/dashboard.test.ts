import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { applications, areas, roadmaps, user } from "../../src/db/schema";
import { getDashboard } from "../../src/server/dashboard";
import { db, makeActiveSprint, makeActor, makeArea, resetDb } from "../helpers/db";
import { H, T0, at, makeMember, setupCycle, takenTicket, type Cycle } from "../helpers/cycle";
import { expectMainAdminOnly, insertAudit, insertEvaluation, insertRequest } from "../helpers/admin";
import { makeManagerActor, makeTicketRow } from "../helpers/plan";

beforeEach(resetDb);

const mk = (c: Cycle, areaId: string, status: string, over: Record<string, unknown> = {}) =>
  makeTicketRow({ areaId, sprintId: c.sprint.id, createdById: c.admin.id, status: status as never, ...over });

describe("getDashboard: yetki", () => {
  it("yalnız ana yönetici görür", async () => {
    const c = await setupCycle();
    await expectMainAdminOnly(c, (a) => getDashboard(db, a, T0));
    await expect(getDashboard(db, c.admin, T0)).resolves.toBeTruthy();
  });
});

describe("getDashboard: aktif sprint yok", () => {
  it("hata vermez; sprint null, sayaçlar sıfır", async () => {
    const admin = await makeActor({ isMainAdmin: true });
    await makeArea({ name: "Boş Alan" });
    const v = await getDashboard(db, admin, T0);
    expect(v.sprint).toBeNull();
    expect(v.totals).toEqual({ draft: 0, pool: 0, offered: 0, inProgress: 0, overdue: 0, submitted: 0, evaluated: 0, cancelled: 0, total: 0 });
    expect(v.areas.map((a) => a.name)).toEqual(["Boş Alan"]);
    expect(v.areas[0]!.counts.total).toBe(0);
    expect(v.closingSprints).toEqual([]);
    expect(v.evaluations).toMatchObject({ good: 0, bad: 0, recent: [] });
    expect(v.requests).toMatchObject({ items: [], pending: 0, overdue: 0 });
  });
});

describe("getDashboard: sprint ve sayaçlar", () => {
  it("sprint günü ve kalan gün", async () => {
    const c = await setupCycle();
    const v = await getDashboard(db, c.admin, T0);
    expect(v.sprint?.id).toBe(c.sprint.id);
    expect(v.sprint?.day).toBe(18);
    expect(v.sprint?.daysLeft).toBe(3);
  });

  it("alan x durum sayaçları: pool = available+returned_to_pool, inProgress üç durum", async () => {
    const c = await setupCycle();
    const A = c.areaA.id;
    for (const s of ["draft", "available", "returned_to_pool", "cancelled", "evaluated", "submitted"]) await mk(c, A, s);
    await mk(c, A, "offered", { assigneeId: c.member.id, offeredAt: T0 });
    for (const s of ["taken", "extension_pending", "withdrawal_pending"]) {
      await mk(c, A, s, { assigneeId: c.member.id, takenAt: T0, dueAt: at(10 * H) });
    }
    await mk(c, c.areaB.id, "available");
    // Başka sprintin ticket'ı totals'a girmez.
    const other = await makeActiveSprint({ number: 2, name: "Eski", status: "closed", startDate: "2026-10-01" });
    await makeTicketRow({ areaId: A, sprintId: other.id, createdById: c.admin.id, status: "available" });

    const v = await getDashboard(db, c.admin, T0);
    const a = v.areas.find((x) => x.id === A)!;
    expect(a.counts).toEqual({ draft: 1, pool: 2, offered: 1, inProgress: 3, overdue: 0, submitted: 1, evaluated: 1, cancelled: 1, total: 10 });
    expect(a.toEvaluate).toBe(1);
    expect(v.areas.find((x) => x.id === c.areaB.id)!.counts.pool).toBe(1);
    expect(v.totals.total).toBe(11);
    expect(v.totals.pool).toBe(3);
    expect(v.totals.inProgress).toBe(3);
  });

  it("arşivli alan listede yok; alanlar ada göre", async () => {
    const c = await setupCycle();
    await makeArea({ name: "Arşiv", archivedAt: T0 });
    await db.update(areas).set({ name: "Zzz" }).where(eq(areas.id, c.areaA.id));
    await db.update(areas).set({ name: "Aaa" }).where(eq(areas.id, c.areaB.id));
    const v = await getDashboard(db, c.admin, T0);
    const names = v.areas.map((a) => a.name);
    expect(names).not.toContain("Arşiv");
    expect(names[0]).toBe("Aaa");
    expect(names[names.length - 1]).toBe("Zzz");
  });

  it("roadmapStatus aktif sprintteki roadmap durumu; yoksa null", async () => {
    const c = await setupCycle();
    await db.insert(roadmaps).values({ areaId: c.areaA.id, sprintId: c.sprint.id, status: "approved" });
    const v = await getDashboard(db, c.admin, T0);
    expect(v.areas.find((a) => a.id === c.areaA.id)!.roadmapStatus).toBe("approved");
    expect(v.areas.find((a) => a.id === c.areaB.id)!.roadmapStatus).toBeNull();
  });
});

describe("getDashboard: süresi dolanlar", () => {
  it("dueAt <= şimdi overdue; duraklı ve gelecek olan değil", async () => {
    const c = await setupCycle();
    const A = c.areaA.id;
    const past = await takenTicket(c, A, c.member, { dueAt: at(-H) });
    const exact = await takenTicket(c, A, c.member, { dueAt: T0 });
    await takenTicket(c, A, c.member, { dueAt: at(H) });
    await takenTicket(c, A, c.member, { dueAt: at(-5 * H), pausedAt: at(-2 * H), status: "extension_pending" });
    const v = await getDashboard(db, c.admin, T0);
    expect(v.areas.find((a) => a.id === A)!.counts.overdue).toBe(2);
    expect(v.totals.overdue).toBe(2);
    expect(v.overdueTickets.map((t) => t.id).sort()).toEqual([past.id, exact.id].sort());
  });

  it("overdueTickets tüm sprintlerden, en eski dolan önce; totals yalnız aktif sprint", async () => {
    const c = await setupCycle();
    const closing = await makeActiveSprint({ number: 2, name: "Kapanan", status: "closing", startDate: "2026-10-01" });
    const old = await makeTicketRow({
      areaId: c.areaA.id, sprintId: closing.id, createdById: c.admin.id, status: "taken", assigneeId: c.member.id, dueAt: at(-48 * H),
    });
    const recent = await takenTicket(c, c.areaA.id, c.member, { dueAt: at(-H) });
    const v = await getDashboard(db, c.admin, T0);
    expect(v.overdueTickets.map((t) => t.id)).toEqual([old.id, recent.id]);
    expect(v.totals.overdue).toBe(1);
  });
});

describe("getDashboard: pasif kişide kalanlar", () => {
  it("pasif kişideki offered/taken listelenir; aktif kişininki değil", async () => {
    const c = await setupCycle();
    const ghost = await makeMember(c.home.id, "Pasif");
    const offered = await mk(c, c.areaA.id, "offered", { assigneeId: ghost.id, offeredAt: T0 });
    const taken = await takenTicket(c, c.areaA.id, ghost);
    const activeOne = await takenTicket(c, c.areaA.id, c.member);
    await db.update(user).set({ active: false }).where(eq(user.id, ghost.id));
    const v = await getDashboard(db, c.admin, T0);
    const ids = v.inactiveHeld.map((t) => t.id);
    expect([...ids].sort()).toEqual([offered.id, taken.id].sort());
    expect(ids).not.toContain(activeOne.id);
    expect(v.inactiveHeld[0]!.assignee?.id).toBe(ghost.id);
  });

  it("pasif kişide submitted olan ticket listelenmez", async () => {
    const c = await setupCycle();
    const ghost = await makeMember(c.home.id, "Pasif");
    await mk(c, c.areaA.id, "submitted", { assigneeId: ghost.id });
    await db.update(user).set({ active: false }).where(eq(user.id, ghost.id));
    expect((await getDashboard(db, c.admin, T0)).inactiveHeld).toEqual([]);
  });
});

describe("getDashboard: alan yöneticisi eksik", () => {
  it("yöneticisiz ve pasif yöneticili alan managerMissing; aktif yöneticili değil", async () => {
    const c = await setupCycle();
    const dead = await makeManagerActor();
    await db.update(user).set({ active: false }).where(eq(user.id, dead.user.id));
    const v = await getDashboard(db, c.admin, T0);
    const by = (id: string) => v.areas.find((a) => a.id === id)!;
    expect(by(c.areaA.id).managerMissing).toBe(false);
    expect(by(c.areaA.id).manager?.id).toBe(c.mgrA.id);
    expect(by(c.home.id).managerMissing).toBe(true);
    expect(by(c.home.id).manager).toBeNull();
    expect(by(dead.area.id).managerMissing).toBe(true);
  });
});

describe("getDashboard: talepler", () => {
  it("bekleyen/cevapsız toplamları ve alan bazında sayılar", async () => {
    const c = await setupCycle();
    const A = c.areaA.id;
    const t = async (areaId = A) => takenTicket(c, areaId, c.member);
    // cevapsız: overdueAt dolu
    await insertRequest({ ticketId: (await t()).id, requesterId: c.member.id, overdueAt: at(-H), respondBy: at(5 * H) });
    // cevapsız: respondBy geçmiş
    await insertRequest({ ticketId: (await t()).id, requesterId: c.member.id, respondBy: at(-H) });
    // cevapsız değil: respondBy geçmiş ama talep sahibinin cevabı bekleniyor
    await insertRequest({ ticketId: (await t()).id, requesterId: c.member.id, respondBy: at(-H), awaitingRequesterAt: at(-2 * H) });
    // cevapsız değil: süre var
    await insertRequest({ ticketId: (await t()).id, requesterId: c.member.id, respondBy: at(5 * H) });
    // başka alan, bekleyen
    await insertRequest({ ticketId: (await t(c.areaB.id)).id, requesterId: c.member.id, respondBy: at(5 * H) });
    // sonuçlanmış talep sayılmaz
    await insertRequest({ ticketId: (await t()).id, requesterId: c.member.id, status: "approved", respondBy: at(-H) });

    const v = await getDashboard(db, c.admin, T0);
    expect(v.requests.pending).toBe(5);
    expect(v.requests.overdue).toBe(2);
    expect(v.requests.items).toHaveLength(5);
    const a = v.areas.find((x) => x.id === A)!;
    expect(a.pendingRequests).toBe(4);
    expect(a.overdueRequests).toBe(2);
    expect(v.areas.find((x) => x.id === c.areaB.id)!.pendingRequests).toBe(1);
  });

  it("liste en fazla 20; cevapsızlar önce, toplam gerçek sayı", async () => {
    const c = await setupCycle();
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) {
      const tk = await takenTicket(c, c.areaA.id, c.member);
      const overdue = i >= 19; // son 3 cevapsız ve respondBy en geç
      const r = await insertRequest({
        ticketId: tk.id,
        requesterId: c.member.id,
        respondBy: at((i + 1) * H),
        overdueAt: overdue ? at(-H) : null,
      });
      if (overdue) ids.push(r.id);
    }
    const v = await getDashboard(db, c.admin, T0);
    expect(v.requests.items).toHaveLength(20);
    expect(v.requests.pending).toBe(22);
    expect(v.requests.items.slice(0, 3).map((r) => r.id).sort()).toEqual(ids.sort());
  });
});

describe("getDashboard: kapanan sprintler, değerlendirmeler, bekleyenler", () => {
  it("closingSprints kararsız sayısı", async () => {
    const c = await setupCycle();
    const closing = await makeActiveSprint({ number: 2, name: "Kapanıyor", status: "closing", startDate: "2026-10-01" });
    const mkc = (status: string) =>
      makeTicketRow({
        areaId: c.areaA.id,
        sprintId: closing.id,
        createdById: c.admin.id,
        status: status as never,
        assigneeId: status === "taken" || status === "extension_pending" ? c.member.id : null,
      });
    for (const s of ["taken", "available", "extension_pending", "submitted", "evaluated", "cancelled"]) await mkc(s);
    const v = await getDashboard(db, c.admin, T0);
    expect(v.closingSprints).toHaveLength(1);
    expect(v.closingSprints[0]!.sprint.id).toBe(closing.id);
    expect(v.closingSprints[0]!.undecided).toBe(3);
  });

  it("evaluations good/bad yalnız aktif sprint; recent en fazla 10, en yeni önce", async () => {
    const c = await setupCycle();
    const old = await makeActiveSprint({ number: 2, name: "Eski", status: "closed", startDate: "2026-10-01" });
    const oldT = await makeTicketRow({ areaId: c.areaA.id, sprintId: old.id, createdById: c.admin.id, status: "evaluated", assigneeId: c.member.id });
    await insertEvaluation({ ticketId: oldT.id, evaluatorId: c.mgrA.id, verdict: "bad", createdAt: at(-100 * H) });
    const titles: string[] = [];
    for (let i = 0; i < 12; i++) {
      const tk = await mk(c, c.areaA.id, "evaluated", { assigneeId: c.member.id, title: `Ev ${i}` });
      await insertEvaluation({ ticketId: tk.id, evaluatorId: c.mgrA.id, verdict: i < 8 ? "good" : "bad", createdAt: at(-(20 - i) * H) });
      titles.push(tk.title);
    }
    const v = await getDashboard(db, c.admin, T0);
    expect(v.evaluations.good).toBe(8);
    expect(v.evaluations.bad).toBe(4);
    expect(v.evaluations.recent).toHaveLength(10);
    expect(v.evaluations.recent.map((r) => r.ticketTitle)).toEqual([...titles].reverse().slice(0, 10));
    expect(v.evaluations.recent[0]).toMatchObject({ verdict: "bad", areaName: c.areaA.name });
    expect(v.evaluations.recent[0]!.evaluator.id).toBe(c.mgrA.id);
    expect(v.evaluations.recent[0]!.assignee?.id).toBe(c.member.id);
  });

  it("pendingApplications ve roadmapsAwaiting", async () => {
    const c = await setupCycle();
    const mkApp = (n: string, status: "pending" | "rejected") =>
      db.insert(applications).values({ fullName: n, username: n, email: `${n}@x.com`, phone: "5", intro: "i", status });
    await mkApp("a1", "pending");
    await mkApp("a2", "pending");
    await mkApp("a3", "rejected");
    await db.insert(roadmaps).values({ areaId: c.areaA.id, sprintId: c.sprint.id, status: "submitted" });
    await db.insert(roadmaps).values({ areaId: c.areaB.id, sprintId: c.sprint.id, status: "approved" });
    const v = await getDashboard(db, c.admin, T0);
    expect(v.pendingApplications).toBe(2);
    expect(v.roadmapsAwaiting).toBe(1);
  });

  it("recentActivity en fazla 15, en yeni önce", async () => {
    const c = await setupCycle();
    for (let i = 0; i < 20; i++) await insertAudit({ action: "ticket.create", actorId: c.admin.id, entityId: String(i) });
    const v = await getDashboard(db, c.admin, T0);
    expect(v.recentActivity).toHaveLength(15);
    expect(v.recentActivity[0]!.entityId).toBe("19");
    expect(v.recentActivity[14]!.entityId).toBe("5");
  });
});
