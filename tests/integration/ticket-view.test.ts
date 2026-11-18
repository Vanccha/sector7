import { beforeEach, describe, expect, it } from "vitest";
import { evaluateTicket, submitTicket } from "../../src/server/delivery";
import { createRequest, postRequestMessage } from "../../src/server/ticket-requests";
import { getAreaTracking, getTicketDetail, listOpenRequests } from "../../src/server/ticket-view";
import { db, resetDb } from "../helpers/db";
import { H, SEC, at, makeMember, poolTicket, setupCycle, takenTicket, T0 } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { ticketRequests } from "../../src/db/schema";
import { eq } from "drizzle-orm";

beforeEach(resetDb);

async function setup() {
  const c = await setupCycle();
  const t = await takenTicket(c, c.areaA.id, c.member);
  return { c, t };
}

describe("getTicketDetail yetkisi", () => {
  it("assignee, alan yöneticisi ve ana yönetici görür", async () => {
    const { c, t } = await setup();
    for (const who of [c.member, c.mgrA, c.admin]) {
      const d = await getTicketDetail(db, who, { ticketId: t.id }, at(H));
      expect(d.ticket.id).toBe(t.id);
    }
  });

  it("ilgisiz üye ve başka alanın yöneticisi FORBIDDEN", async () => {
    const { c, t } = await setup();
    const other = await makeMember(c.home.id);
    await expectCode(getTicketDetail(db, other, { ticketId: t.id }, at(H)), "FORBIDDEN");
    await expectCode(getTicketDetail(db, c.mgrB, { ticketId: t.id }, at(H)), "FORBIDDEN");
  });

  it("havuzdaki ticket'ı üye göremez", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    await expectCode(getTicketDetail(db, c.member, { ticketId: t.id }, T0), "FORBIDDEN");
  });

  it("var olmayan ticket NOT_FOUND", async () => {
    const { c } = await setup();
    await expectCode(getTicketDetail(db, c.admin, { ticketId: "00000000-0000-4000-8000-000000000000" }, T0), "NOT_FOUND");
  });

  it("perms: taken iken assignee / yönetici", async () => {
    const { c, t } = await setup();
    const m = (await getTicketDetail(db, c.member, { ticketId: t.id }, at(H))).perms;
    expect(m).toMatchObject({
      isAssignee: true,
      canManage: false,
      canRequestExtension: true,
      canRequestWithdrawal: true,
      canSubmit: true,
      canEvaluate: false,
      canRespond: false,
      canMessage: false,
      canCancelRequest: false,
    });
    const g = (await getTicketDetail(db, c.mgrA, { ticketId: t.id }, at(H))).perms;
    expect(g).toMatchObject({ isAssignee: false, canManage: true, canSubmit: false, canEvaluate: false, canRequestExtension: false });
    expect(g.canManage).toBe(true);
  });

  it("perms: bekleyen talepte talep sahibi iptal/mesaj, yönetici cevap/mesaj", async () => {
    const { c, t } = await setup();
    await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(SEC));
    const m = await getTicketDetail(db, c.member, { ticketId: t.id }, at(2 * SEC));
    expect(m.pendingRequest?.kind).toBe("extension");
    expect(m.perms).toMatchObject({
      canCancelRequest: true,
      canMessage: true,
      canRespond: false,
      canRequestExtension: false,
      canRequestWithdrawal: false,
      canSubmit: true,
    });
    const g = await getTicketDetail(db, c.mgrA, { ticketId: t.id }, at(2 * SEC));
    expect(g.perms).toMatchObject({ canRespond: true, canMessage: true, canCancelRequest: false });
    expect(g.messages.length).toBeGreaterThan(0);
  });

  it("perms: talep sahibi ana yönetici ise canRespond false", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.admin);
    await createRequest(db, c.admin, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(SEC));
    const d = await getTicketDetail(db, c.admin, { ticketId: t.id }, at(2 * SEC));
    expect(d.perms).toMatchObject({ canManage: true, canRespond: false, canCancelRequest: true, canEvaluate: false });
  });

  it("perms: submitted iken yönetici değerlendirebilir, assignee yeniden teslim edebilir", async () => {
    const { c, t } = await setup();
    await submitTicket(db, c.member, { ticketId: t.id, description: "Teslim ettim", links: [], fileIds: [] }, at(H));
    const g = (await getTicketDetail(db, c.mgrA, { ticketId: t.id }, at(2 * H))).perms;
    expect(g.canEvaluate).toBe(true);
    const m = (await getTicketDetail(db, c.member, { ticketId: t.id }, at(2 * H))).perms;
    expect(m).toMatchObject({ canSubmit: true, canEvaluate: false });
    await evaluateTicket(db, c.mgrA, { ticketId: t.id, verdict: "good" }, at(3 * H));
    const after = await getTicketDetail(db, c.member, { ticketId: t.id }, at(4 * H));
    expect(after.perms.canSubmit).toBe(false);
    expect(after.evaluations).toHaveLength(1);
    expect(after.submissions).toHaveLength(1);
  });

  it("perms: offered iken canAnswerOffer yalnız süresi geçmemişse; kota döner", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member, { status: "offered", offeredAt: T0, dueAt: null, takenAt: null });
    const live = await getTicketDetail(db, c.member, { ticketId: t.id }, at(10 * 60_000));
    expect(live.perms.canAnswerOffer).toBe(true);
    expect(live.rejections).toEqual({ used: 0, limit: 2, remaining: 2 });
    const stale = await getTicketDetail(db, c.member, { ticketId: t.id }, at(31 * 60_000));
    expect(stale.perms.canAnswerOffer).toBe(false);
    const g = await getTicketDetail(db, c.mgrA, { ticketId: t.id }, at(10 * 60_000));
    expect(g.perms.canAnswerOffer).toBe(false);
  });
});

describe("getAreaTracking", () => {
  it("başka alanın yöneticisi ve üye FORBIDDEN; kendi yöneticisi ve ana yönetici görür", async () => {
    const { c } = await setup();
    await expectCode(getAreaTracking(db, c.mgrB, { areaId: c.areaA.id }, T0), "FORBIDDEN");
    await expectCode(getAreaTracking(db, c.member, { areaId: c.areaA.id }, T0), "FORBIDDEN");
    expect((await getAreaTracking(db, c.mgrA, { areaId: c.areaA.id }, T0)).area.id).toBe(c.areaA.id);
    expect((await getAreaTracking(db, c.admin, { areaId: c.areaA.id }, T0)).area.id).toBe(c.areaA.id);
  });

  it("sayımlar, devam edenler, bekleyen talepler ve değerlendirilecekler", async () => {
    const { c, t } = await setup();
    await poolTicket(c, c.areaA.id);
    const done = await takenTicket(c, c.areaA.id, c.member);
    await submitTicket(db, c.member, { ticketId: done.id, description: "Teslim ettim", links: [], fileIds: [] }, at(H));
    await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(SEC));
    const v = await getAreaTracking(db, c.mgrA, { areaId: c.areaA.id }, at(2 * H));
    expect(v.counts).toMatchObject({ pool: 1, inProgress: 1, submitted: 1 });
    expect(v.inProgress.map((r) => r.id)).toEqual([t.id]);
    expect(v.inProgress[0]!.pendingRequest?.kind).toBe("extension");
    expect(v.pendingRequests).toHaveLength(1);
    expect(v.toEvaluate.map((r) => r.id)).toEqual([done.id]);
  });
});

describe("listOpenRequests", () => {
  it("üye FORBIDDEN", async () => {
    const { c } = await setup();
    await expectCode(listOpenRequests(db, c.member, T0), "FORBIDDEN");
  });

  it("yönetici yalnız kendi alanının taleplerini, ana yönetici hepsini görür; cevapsız önce", async () => {
    const c = await setupCycle();
    const t1 = await takenTicket(c, c.areaA.id, c.member);
    const t2 = await takenTicket(c, c.areaA.id, c.member);
    const tb = await takenTicket(c, c.areaB.id, c.member);
    const r1 = await createRequest(db, c.member, { ticketId: t1.id, kind: "extension", reason: "Birinci talep" }, at(SEC));
    const r2 = await createRequest(db, c.member, { ticketId: t2.id, kind: "withdrawal", reason: "İkinci talep" }, at(2 * SEC));
    await createRequest(db, c.member, { ticketId: tb.id, kind: "extension", reason: "B alanı talebi" }, at(3 * SEC));
    // r2 cevapsız işaretli; r1'den sonra açılmış olsa da önce gelmeli.
    await db.update(ticketRequests).set({ overdueAt: at(30 * H) }).where(eq(ticketRequests.id, r2.id));

    const a = await listOpenRequests(db, c.mgrA, at(H));
    expect(a.map((r) => r.id)).toEqual([r2.id, r1.id]);
    expect(a[0]!.ticket.areaName).toBe(c.areaA.name);
    const b = await listOpenRequests(db, c.mgrB, at(H));
    expect(b).toHaveLength(1);
    const all = await listOpenRequests(db, c.admin, at(H));
    expect(all).toHaveLength(3);
    expect(all[0]!.id).toBe(r2.id);
  });

  it("cevaplanmış talepler listelenmez", async () => {
    const { c, t } = await setup();
    const r = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(SEC));
    await postRequestMessage(db, c.mgrA, { requestId: r.id, body: "Soru" }, at(2 * SEC));
    expect(await listOpenRequests(db, c.mgrA, at(H))).toHaveLength(1);
    await db.update(ticketRequests).set({ status: "approved" }).where(eq(ticketRequests.id, r.id));
    expect(await listOpenRequests(db, c.mgrA, at(H))).toHaveLength(0);
  });
});
