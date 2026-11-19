import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVE_LIMIT_MESSAGE } from "../../src/lib/contracts/tickets";
import { acceptOffer, getMyTickets, requestTicket } from "../../src/server/pool";
import { db, resetDb } from "../helpers/db";
import { poolTicket, setSetting, setupCycle, takenTicket, ticketById, T0 } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";

beforeEach(resetDb);

describe("tek aktif ticket kuralı (2026-11-19)", () => {
  it("aktif ticket'ı varken ticket istenemez; havuz değişmez", async () => {
    const c = await setupCycle();
    await takenTicket(c, c.areaA.id, c.member);
    const free = await poolTicket(c, c.areaB.id);
    await expectCode(requestTicket(db, c.member, T0), "INVALID_STATE");
    await expect(requestTicket(db, c.member, T0)).rejects.toThrow(ACTIVE_LIMIT_MESSAGE);
    expect((await ticketById(free.id)).status).toBe("available");
    expect((await getMyTickets(db, c.member, T0)).activeLimitReached).toBe(true);
  });

  it("ek süre ya da geri çekme bekleyen ticket da aktif sayılır", async () => {
    for (const status of ["extension_pending", "withdrawal_pending"] as const) {
      await resetDb();
      const c = await setupCycle();
      await takenTicket(c, c.areaA.id, c.member, { status });
      await poolTicket(c, c.areaB.id);
      await expectCode(requestTicket(db, c.member, T0), "INVALID_STATE");
    }
  });

  it("teslim edince kişi serbest kalır (değerlendirme beklenmez)", async () => {
    const c = await setupCycle();
    await takenTicket(c, c.areaA.id, c.member, { status: "submitted" });
    await poolTicket(c, c.areaB.id);
    expect((await requestTicket(db, c.member, T0)).kind).toBe("offered");
    expect((await getMyTickets(db, c.member, T0)).activeLimitReached).toBe(false);
  });

  it("bekleyen teklif varken istek aynı teklifi döndürür, ikinci ticket çekmez", async () => {
    const c = await setupCycle();
    await poolTicket(c, c.areaA.id);
    await poolTicket(c, c.areaB.id);
    const r1 = await requestTicket(db, c.member, T0);
    const r2 = await requestTicket(db, c.member, T0);
    expect(r1.kind === "offered" && r2.kind === "offered" && r1.offer.ticket.id === r2.offer.ticket.id).toBe(true);
  });

  it("red hakkı bitmişken de (doğrudan atama) aktif ticket varsa istek reddedilir", async () => {
    const c = await setupCycle();
    await setSetting("rejectionsPerSprint", 0);
    await takenTicket(c, c.areaA.id, c.member);
    const free = await poolTicket(c, c.areaB.id);
    await expectCode(requestTicket(db, c.member, T0), "INVALID_STATE");
    expect((await ticketById(free.id)).assigneeId).toBeNull();
  });

  it("teklif kabulü, bu arada aktif ticket edinilmişse reddedilir", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    const r = await requestTicket(db, c.member, T0);
    expect(r.kind).toBe("offered");
    await takenTicket(c, c.areaB.id, c.member); // ör. eski veri ya da başka yol
    await expectCode(acceptOffer(db, c.member, { ticketId: t.id }, T0), "INVALID_STATE");
    expect((await ticketById(t.id)).status).toBe("offered");
  });

  it("eşzamanlı istekler kişiye tek ticket düşürür", async () => {
    const c = await setupCycle();
    await setSetting("rejectionsPerSprint", 0); // doğrudan atama yolu
    for (let i = 0; i < 4; i++) await poolTicket(c, c.areaA.id);
    const rs = await Promise.allSettled([1, 2, 3].map(() => requestTicket(db, c.member, T0)));
    expect(rs.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect((await getMyTickets(db, c.member, T0)).active.length).toBe(1);
  });
});
