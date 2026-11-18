import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ticketRejections, ticketRequests, tickets } from "../../src/db/schema";
import { requestTicket } from "../../src/server/pool";
import { runScheduledTick } from "../../src/server/scheduler";
import { createRequest, postRequestMessage } from "../../src/server/ticket-requests";
import { db, resetDb } from "../helpers/db";
import {
  H,
  MIN,
  at,
  allNotifs,
  muteInApp,
  notifsOf,
  poolTicket,
  setupCycle,
  takenTicket,
  ticketById,
  T0,
} from "../helpers/cycle";
import { auditRows } from "../helpers/plan";

beforeEach(resetDb);

const tick = (now: Date) => runScheduledTick(db, now);
const reqRow = async (id: string) => (await db.select().from(ticketRequests).where(eq(ticketRequests.id, id)))[0]!;

describe("teklif süresi", () => {
  it("30 dk sonra havuza döner (hak düşmeden); ikinci çalıştırma yeni audit üretmez", async () => {
    const c = await setupCycle();
    await poolTicket(c, c.areaA.id);
    const r = await requestTicket(db, c.member, T0);
    expect(r.kind).toBe("offered");
    const id = r.kind === "offered" ? r.offer.ticket.id : "";

    expect((await tick(at(29 * MIN))).offersExpired).toBe(0);
    expect((await ticketById(id)).status).toBe("offered");

    const res = await tick(at(30 * MIN));
    expect(res.offersExpired).toBe(1);
    expect(await ticketById(id)).toMatchObject({ status: "returned_to_pool", assigneeId: null, offeredAt: null });
    expect(await db.select().from(ticketRejections)).toHaveLength(0);
    expect(await auditRows("ticket.offer_expired", id)).toHaveLength(1);

    const again = await tick(at(30 * MIN));
    expect(again.offersExpired).toBe(0);
    expect(await auditRows("ticket.offer_expired", id)).toHaveLength(1);
  });
});

describe("süre uyarısı ve dolumu", () => {
  it("uyarı dueAt - 12 saatte; assignee'ye bildirim; idempotent", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    expect((await tick(at(59 * H))).warned).toBe(0);
    expect(await notifsOf(c.member.id, "ticket_due_soon")).toHaveLength(0);

    const r = await tick(at(60 * H));
    expect(r.warned).toBe(1);
    expect((await ticketById(t.id)).warnedAt).toEqual(at(60 * H));
    expect(await notifsOf(c.member.id, "ticket_due_soon")).toHaveLength(1);

    const again = await tick(at(60 * H));
    expect(again.warned).toBe(0);
    expect((await tick(at(61 * H))).warned).toBe(0);
    expect(await notifsOf(c.member.id, "ticket_due_soon")).toHaveLength(1);
    expect(await auditRows("ticket.due_warned", t.id)).toHaveLength(1);
  });

  it("dolum bildirimi dueAt anında assignee'ye gider; idempotent", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    expect((await tick(at(72 * H - MIN))).expired).toBe(0);
    const r = await tick(at(72 * H));
    expect(r.expired).toBe(1);
    expect((await ticketById(t.id)).expiredNotifiedAt).toEqual(at(72 * H));
    expect(await notifsOf(c.member.id, "ticket_expired")).toHaveLength(1);
    const again = await tick(at(72 * H));
    expect(again.expired).toBe(0);
    expect((await tick(at(80 * H))).expired).toBe(0);
    expect(await notifsOf(c.member.id, "ticket_expired")).toHaveLength(1);
    expect(await auditRows("ticket.expired", t.id)).toHaveLength(1);
    // Teslim hâlâ açık: ticket durumu değişmez.
    expect((await ticketById(t.id)).status).toBe("taken");
  });

  it("uyarı penceresi atlanıp doğrudan dolmuşsa yalnız dolum bildirimi", async () => {
    const c = await setupCycle();
    await takenTicket(c, c.areaA.id, c.member);
    const r = await tick(at(100 * H));
    expect(r.expired).toBe(1);
    expect(await notifsOf(c.member.id, "ticket_expired")).toHaveLength(1);
    expect(await notifsOf(c.member.id, "ticket_due_soon")).toHaveLength(0);
  });

  it("duraklı ticket'a uyarı ve dolum bildirimi yok", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(50 * H));
    const r = await tick(at(100 * H));
    expect(r.warned).toBe(0);
    expect(r.expired).toBe(0);
    expect(await notifsOf(c.member.id)).toHaveLength(0);
    const row = await ticketById(t.id);
    expect(row.warnedAt).toBeNull();
    expect(row.expiredNotifiedAt).toBeNull();
  });

  it("taken olmayan (submitted) ticket'a uyarı ve dolum yok", async () => {
    const c = await setupCycle();
    await takenTicket(c, c.areaA.id, c.member, { status: "submitted" });
    const r = await tick(at(100 * H));
    expect(r.warned + r.expired).toBe(0);
  });
});

describe("talep hatırlatması ve cevapsız işareti", () => {
  async function pending() {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, T0);
    return { c, t, id };
  }

  it("hatırlatma son çeyrekte (respondBy - 6 saat), alan yöneticisine; idempotent", async () => {
    const { c, id } = await pending();
    expect((await tick(at(18 * H - MIN))).reminded).toBe(0);
    const r = await tick(at(18 * H));
    expect(r.reminded).toBe(1);
    expect((await reqRow(id)).remindedAt).toEqual(at(18 * H));
    expect(await notifsOf(c.mgrA.id, "request_reminder")).toHaveLength(1);
    expect(await notifsOf(c.mgrB.id, "request_reminder")).toHaveLength(0);
    expect((await tick(at(18 * H))).reminded).toBe(0);
    expect((await tick(at(20 * H))).reminded).toBe(0);
    expect(await notifsOf(c.mgrA.id, "request_reminder")).toHaveLength(1);
    expect(await auditRows("request.reminded", id)).toHaveLength(1);
  });

  it("respondBy geçince overdueAt işaretlenir; yöneticiye ve ana yöneticiye bildirim; idempotent", async () => {
    const { c, id } = await pending();
    expect((await tick(at(24 * H - MIN))).overdue).toBe(0);
    const r = await tick(at(24 * H));
    expect(r.overdue).toBe(1);
    expect((await reqRow(id)).overdueAt).toEqual(at(24 * H));
    expect(await notifsOf(c.mgrA.id, "request_overdue")).toHaveLength(1);
    expect(await notifsOf(c.admin.id, "request_overdue")).toHaveLength(1);
    expect(await notifsOf(c.member.id, "request_overdue")).toHaveLength(0);
    expect((await tick(at(24 * H))).overdue).toBe(0);
    expect((await tick(at(30 * H))).overdue).toBe(0);
    expect(await allNotifs("request_overdue")).toHaveLength(2);
    expect(await auditRows("request.overdue", id)).toHaveLength(1);
  });

  it("awaitingRequesterAt doluyken hatırlatma ve cevapsız işareti yok", async () => {
    const { c, id } = await pending();
    await postRequestMessage(db, c.mgrA, { requestId: id, body: "Neden ek süre?" }, at(1 * H));
    const r = await tick(at(30 * H));
    expect(r.reminded).toBe(0);
    expect(r.overdue).toBe(0);
    const row = await reqRow(id);
    expect(row.remindedAt).toBeNull();
    expect(row.overdueAt).toBeNull();
    expect(await allNotifs("request_reminder")).toHaveLength(0);
    expect(await allNotifs("request_overdue")).toHaveLength(0);
  });

  it("talep sahibi cevaplayınca süre yenilenir ve hatırlatma yeni respondBy'a göre gelir", async () => {
    const { c, id } = await pending();
    await postRequestMessage(db, c.mgrA, { requestId: id, body: "Neden ek süre?" }, at(1 * H));
    await postRequestMessage(db, c.member, { requestId: id, body: "Şu yüzden" }, at(26 * H));
    // respondBy = 26h + 24h = 50h; hatırlatma 44h.
    expect((await tick(at(43 * H))).reminded).toBe(0);
    expect((await tick(at(44 * H))).reminded).toBe(1);
    expect((await tick(at(50 * H))).overdue).toBe(1);
  });

  it("cevaplanmış talep için işaret yok", async () => {
    const { id } = await pending();
    await db.update(ticketRequests).set({ status: "rejected" }).where(eq(ticketRequests.id, id));
    const r = await tick(at(100 * H));
    expect(r.reminded + r.overdue).toBe(0);
  });
});

describe("bildirim tercihleri", () => {
  it("inApp kapalı olan kişiye o tür yazılmaz; diğer türler yazılır", async () => {
    const c = await setupCycle();
    await takenTicket(c, c.areaA.id, c.member);
    await muteInApp(c.member.id, "ticket_due_soon");
    const r = await tick(at(60 * H));
    expect(r.warned).toBe(1);
    expect(await notifsOf(c.member.id, "ticket_due_soon")).toHaveLength(0);
    // Dolum bildirimi kapatılmamış: gelir.
    await tick(at(72 * H));
    expect(await notifsOf(c.member.id, "ticket_expired")).toHaveLength(1);
  });

  it("alan yöneticisi talep hatırlatmasını kapattıysa ona yazılmaz", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, T0);
    await muteInApp(c.mgrA.id, "request_reminder");
    expect((await tick(at(18 * H))).reminded).toBe(1);
    expect(await notifsOf(c.mgrA.id, "request_reminder")).toHaveLength(0);
    // request_overdue kapatılmadı.
    await tick(at(24 * H));
    expect(await notifsOf(c.mgrA.id, "request_overdue")).toHaveLength(1);
  });
});

void tickets;
