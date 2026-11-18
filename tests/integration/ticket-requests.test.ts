import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { channels, messages, ticketRequests } from "../../src/db/schema";
import {
  approveRequest,
  cancelRequest,
  createRequest,
  postRequestMessage,
  rejectRequest,
} from "../../src/server/ticket-requests";
import { db, resetDb } from "../helpers/db";
import { H, SEC, at, makeMember, notifsOf, setupCycle, takenTicket, ticketById, T0 } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { auditRows, makeManagerActor } from "../helpers/plan";

beforeEach(resetDb);

async function setup() {
  const c = await setupCycle();
  const t = await takenTicket(c, c.areaA.id, c.member);
  return { c, t };
}

const reqRow = async (id: string) => (await db.select().from(ticketRequests).where(eq(ticketRequests.id, id)))[0]!;

describe("createRequest", () => {
  it("assignee açar; ticket *_pending, pausedAt = now, respondBy = now + 24 saat", async () => {
    const { c, t } = await setup();
    const now = at(10 * SEC);
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, now);
    const row = await ticketById(t.id);
    expect(row.status).toBe("extension_pending");
    expect(row.pausedAt).toEqual(now);
    const r = await reqRow(id);
    expect(r.status).toBe("pending");
    expect(r.respondBy).toEqual(at(10 * SEC + 24 * H));
    expect(r.requesterId).toBe(c.member.id);

    const wd = await takenTicket(c, c.areaA.id, c.member);
    await createRequest(db, c.member, { ticketId: wd.id, kind: "withdrawal", reason: "Yapamayacağım" }, now);
    expect((await ticketById(wd.id)).status).toBe("withdrawal_pending");
  });

  it("alan yöneticisine request_new bildirimi, ticket kanalı ve mesaj, denetim", async () => {
    const { c, t } = await setup();
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(SEC));
    const n = await notifsOf(c.mgrA.id, "request_new");
    expect(n).toHaveLength(1);
    expect(n[0]!.link).toContain(t.id);
    expect(await notifsOf(c.mgrB.id, "request_new")).toHaveLength(0);
    const ch = await db.select().from(channels).where(and(eq(channels.kind, "ticket"), eq(channels.ticketId, t.id)));
    expect(ch).toHaveLength(1);
    const msgs = await db.select().from(messages).where(eq(messages.channelId, ch[0]!.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ requestId: id, authorId: c.member.id, body: "Daha çok zaman lazım" });
    expect(await auditRows("request.create", id)).toHaveLength(1);
  });

  it("assignee olmayan talep açamaz", async () => {
    const { c, t } = await setup();
    const other = await makeMember(c.home.id);
    await expectCode(createRequest(db, other, { ticketId: t.id, kind: "extension", reason: "Deneme deneme" }, T0), "FORBIDDEN");
    await expectCode(createRequest(db, c.mgrA, { ticketId: t.id, kind: "extension", reason: "Deneme deneme" }, T0), "FORBIDDEN");
  });

  it("yalnız taken iken: offered / submitted için INVALID_STATE", async () => {
    const c = await setupCycle();
    for (const status of ["offered", "submitted"] as const) {
      const t = await takenTicket(c, c.areaA.id, c.member, { status, offeredAt: status === "offered" ? T0 : null });
      await expectCode(createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Deneme deneme" }, T0), "INVALID_STATE");
    }
  });

  it("süresi dolmuş taken ticket için de talep açılabilir", async () => {
    const { c, t } = await setup();
    await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Geç kaldım ama" }, at(100 * H));
    expect((await ticketById(t.id)).status).toBe("extension_pending");
  });

  it("ikinci bekleyen talep INVALID_STATE", async () => {
    const { c, t } = await setup();
    await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Birinci talep" }, T0);
    await expectCode(
      createRequest(db, c.member, { ticketId: t.id, kind: "withdrawal", reason: "İkinci talep" }, at(SEC)),
      "INVALID_STATE",
    );
  });

  it("aynı anda iki talep: yalnız biri açılır", async () => {
    const { c, t } = await setup();
    const rs = await Promise.allSettled([
      createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Birinci talep" }, T0),
      createRequest(db, c.member, { ticketId: t.id, kind: "withdrawal", reason: "İkinci talep" }, T0),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const pend = await db.select().from(ticketRequests).where(and(eq(ticketRequests.ticketId, t.id), eq(ticketRequests.status, "pending")));
    expect(pend).toHaveLength(1);
  });
});

describe("duraklatma matematiği", () => {
  it("t0 al, t0+10s talep, t0+30s ret: dueAt 20 sn ileri, kalan süre talepten önceki kalanla aynı", async () => {
    const { c, t } = await setup();
    const before = (await ticketById(t.id)).dueAt!;
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(10 * SEC));
    const paused = await ticketById(t.id);
    const remainingAtRequest = paused.dueAt!.getTime() - at(10 * SEC).getTime();
    await rejectRequest(db, c.mgrA, { requestId: id }, at(30 * SEC));
    const row = await ticketById(t.id);
    expect(row.status).toBe("taken");
    expect(row.pausedAt).toBeNull();
    expect(row.dueAt!.getTime()).toBe(before.getTime() + 20 * SEC);
    expect(row.dueAt!.getTime() - at(30 * SEC).getTime()).toBe(remainingAtRequest);
    expect((await reqRow(id)).status).toBe("rejected");
  });

  it("ek süre onayı: grantedHours yoksa VALIDATION", async () => {
    const { c, t } = await setup();
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, T0);
    await expectCode(approveRequest(db, c.mgrA, { requestId: id }, at(SEC)), "VALIDATION");
    expect((await ticketById(t.id)).status).toBe("extension_pending");
  });

  it("ek süre onayı: dueAt += duraklama + grantedHours, status taken", async () => {
    const { c, t } = await setup();
    const before = (await ticketById(t.id)).dueAt!;
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(10 * SEC));
    await approveRequest(db, c.mgrA, { requestId: id, grantedHours: 5, note: "tamam" }, at(30 * SEC));
    const row = await ticketById(t.id);
    expect(row.status).toBe("taken");
    expect(row.pausedAt).toBeNull();
    expect(row.dueAt!.getTime()).toBe(before.getTime() + 20 * SEC + 5 * H);
    const r = await reqRow(id);
    expect(r).toMatchObject({ status: "approved", grantedHours: 5, respondedById: c.mgrA.id, responseNote: "tamam" });
    expect(await notifsOf(c.member.id, "request_answered")).toHaveLength(1);
    expect(await auditRows("request.approve", id)).toHaveLength(1);
  });

  it("geri çekme onayı: returned_to_pool, assignee/takenAt/dueAt null", async () => {
    const { c, t } = await setup();
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "withdrawal", reason: "Yapamayacağım" }, at(SEC));
    await approveRequest(db, c.mgrA, { requestId: id }, at(5 * SEC));
    const row = await ticketById(t.id);
    expect(row).toMatchObject({ status: "returned_to_pool", assigneeId: null, takenAt: null, dueAt: null, pausedAt: null });
    expect((await reqRow(id)).status).toBe("approved");
  });

  it("geri çekme reddi: ticket taken, süre devam eder", async () => {
    const { c, t } = await setup();
    const before = (await ticketById(t.id)).dueAt!;
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "withdrawal", reason: "Yapamayacağım" }, at(SEC));
    await rejectRequest(db, c.mgrA, { requestId: id, note: "devam et" }, at(11 * SEC));
    const row = await ticketById(t.id);
    expect(row.status).toBe("taken");
    expect(row.assigneeId).toBe(c.member.id);
    expect(row.dueAt!.getTime()).toBe(before.getTime() + 10 * SEC);
    expect(await auditRows("request.reject", id)).toHaveLength(1);
  });
});

describe("cevaplayan yetkisi", () => {
  async function pending() {
    const { c, t } = await setup();
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, T0);
    return { c, t, id };
  }

  it("alan yöneticisi ve ana yönetici cevaplayabilir", async () => {
    const p1 = await pending();
    await approveRequest(db, p1.c.mgrA, { requestId: p1.id, grantedHours: 2 }, at(SEC));
    expect((await reqRow(p1.id)).status).toBe("approved");
    await resetDb();
    const p2 = await pending();
    await rejectRequest(db, p2.c.admin, { requestId: p2.id }, at(SEC));
    expect((await reqRow(p2.id)).status).toBe("rejected");
  });

  it("başka alanın yöneticisi FORBIDDEN", async () => {
    const { c, id } = await pending();
    await expectCode(approveRequest(db, c.mgrB, { requestId: id, grantedHours: 2 }, at(SEC)), "FORBIDDEN");
    await expectCode(rejectRequest(db, c.mgrB, { requestId: id }, at(SEC)), "FORBIDDEN");
    expect((await reqRow(id)).status).toBe("pending");
  });

  it("ilgisiz üye ve talep sahibi kendi talebini cevaplayamaz", async () => {
    const { c, id } = await pending();
    const other = await makeMember(c.home.id);
    await expectCode(approveRequest(db, other, { requestId: id, grantedHours: 2 }, at(SEC)), "FORBIDDEN");
    await expectCode(approveRequest(db, c.member, { requestId: id, grantedHours: 2 }, at(SEC)), "FORBIDDEN");
    await expectCode(rejectRequest(db, c.member, { requestId: id }, at(SEC)), "FORBIDDEN");
  });

  it("talep sahibi ana yönetici olsa bile kendi talebini cevaplayamaz", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.admin);
    const { id } = await createRequest(db, c.admin, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, T0);
    await expectCode(approveRequest(db, c.admin, { requestId: id, grantedHours: 2 }, at(SEC)), "FORBIDDEN");
    await expectCode(rejectRequest(db, c.admin, { requestId: id }, at(SEC)), "FORBIDDEN");
    // Alan yöneticisi cevaplayabilir.
    await rejectRequest(db, c.mgrA, { requestId: id }, at(SEC));
  });

  it("cevaplanmış talep tekrar cevaplanamaz (INVALID_STATE)", async () => {
    const { c, id } = await pending();
    await rejectRequest(db, c.mgrA, { requestId: id }, at(SEC));
    await expectCode(rejectRequest(db, c.mgrA, { requestId: id }, at(2 * SEC)), "INVALID_STATE");
    await expectCode(approveRequest(db, c.mgrA, { requestId: id, grantedHours: 2 }, at(2 * SEC)), "INVALID_STATE");
  });
});

describe("konuşma", () => {
  async function pending() {
    const { c, t } = await setup();
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, T0);
    return { c, t, id };
  }

  it("yönetici yazarsa awaitingRequesterAt dolar; talep sahibi cevaplayınca temizlenir, respondBy yenilenir", async () => {
    const { c, id } = await pending();
    await db.update(ticketRequests).set({ remindedAt: at(H), overdueAt: at(2 * H) }).where(eq(ticketRequests.id, id));
    await postRequestMessage(db, c.mgrA, { requestId: id, body: "Neden ek süre?" }, at(3 * H));
    let r = await reqRow(id);
    expect(r.awaitingRequesterAt).toEqual(at(3 * H));
    expect(await notifsOf(c.member.id, "request_message")).toHaveLength(1);

    await postRequestMessage(db, c.member, { requestId: id, body: "Şu yüzden" }, at(5 * H));
    r = await reqRow(id);
    expect(r.awaitingRequesterAt).toBeNull();
    expect(r.respondBy).toEqual(at(5 * H + 24 * H));
    expect(r.remindedAt).toBeNull();
    expect(r.overdueAt).toBeNull();
    expect(await notifsOf(c.mgrA.id, "request_message")).toHaveLength(1);
  });

  it("ana yönetici de yazabilir; mesajlar ticket kanalına düşer", async () => {
    const { c, t, id } = await pending();
    await postRequestMessage(db, c.admin, { requestId: id, body: "Merhaba" }, at(SEC));
    const [ch] = await db.select().from(channels).where(and(eq(channels.kind, "ticket"), eq(channels.ticketId, t.id)));
    const msgs = await db.select().from(messages).where(eq(messages.channelId, ch!.id));
    expect(msgs.map((m) => m.body)).toContain("Merhaba");
    expect((await reqRow(id)).awaitingRequesterAt).toEqual(at(SEC));
  });

  it("yetkisiz kişi mesaj yazamaz", async () => {
    const { c, id } = await pending();
    const other = await makeMember(c.home.id);
    await expectCode(postRequestMessage(db, other, { requestId: id, body: "Selam" }, at(SEC)), "FORBIDDEN");
    await expectCode(postRequestMessage(db, c.mgrB, { requestId: id, body: "Selam" }, at(SEC)), "FORBIDDEN");
  });

  it("cevaplanmış talebe mesaj yazılamaz", async () => {
    const { c, id } = await pending();
    await rejectRequest(db, c.mgrA, { requestId: id }, at(SEC));
    await expectCode(postRequestMessage(db, c.member, { requestId: id, body: "Selam" }, at(2 * SEC)), "INVALID_STATE");
  });
});

describe("cancelRequest", () => {
  it("talep sahibi iptal eder: cancelled, geri sayım devam (pausedAt null)", async () => {
    const { c, t } = await setup();
    const before = (await ticketById(t.id)).dueAt!;
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(10 * SEC));
    await cancelRequest(db, c.member, { requestId: id }, at(40 * SEC));
    expect((await reqRow(id)).status).toBe("cancelled");
    const row = await ticketById(t.id);
    expect(row.status).toBe("taken");
    expect(row.pausedAt).toBeNull();
    expect(row.dueAt!.getTime()).toBe(before.getTime() + 30 * SEC);
    expect(await auditRows("request.cancel", id)).toHaveLength(1);
    // Yeni talep açılabilir.
    await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Yeniden talep" }, at(50 * SEC));
  });

  it("talep sahibi dışındakiler iptal edemez", async () => {
    const { c, t } = await setup();
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, T0);
    await expectCode(cancelRequest(db, c.mgrA, { requestId: id }, at(SEC)), "FORBIDDEN");
    await expectCode(cancelRequest(db, c.admin, { requestId: id }, at(SEC)), "FORBIDDEN");
    expect((await reqRow(id)).status).toBe("pending");
  });
});

void makeManagerActor;
