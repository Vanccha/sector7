import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { areas, ticketDependencies, ticketRejections, tickets } from "../../src/db/schema";
import { acceptOffer, getMyTickets, rejectOffer, requestTicket } from "../../src/server/pool";
import { db, makeActor, makeActiveSprint, makeArea, resetDb } from "../helpers/db";
import {
  H,
  MIN,
  at,
  makeMember,
  poolTicket,
  resetToPool,
  setupCycle,
  takenTicket,
  ticketById,
  T0,
} from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { auditRows, makeManagerActor, makeTicketRow } from "../helpers/plan";

beforeEach(resetDb);

describe("requestTicket: havuz kapsamı", () => {
  it("aktif sprint yoksa INVALID_STATE", async () => {
    const c = await setupCycle();
    await db.execute(sql`update sprints set status = 'closed'`);
    await expectCode(requestTicket(db, c.member, T0), "INVALID_STATE");
  });

  it("yalnız aktif sprintin ticket'ı gelir (planlı sprintinki gelmez)", async () => {
    const c = await setupCycle();
    const planned = await makeActiveSprint({ number: 2, name: "Sprint 2", status: "planned" });
    await makeTicketRow({ areaId: c.areaA.id, sprintId: planned.id, createdById: c.admin.id, status: "available" });
    expect((await requestTicket(db, c.member, T0)).kind).toBe("empty");
    const t = await poolTicket(c, c.areaA.id);
    const r = await requestTicket(db, c.member, T0);
    expect(r.kind).toBe("offered");
    if (r.kind === "offered") expect(r.offer.ticket.id).toBe(t.id);
  });

  it("ana alan ve yönetilen alanın ticket'ı asla gelmez (çok denemeyle)", async () => {
    const c = await setupCycle();
    // Hem ana alanı `home` hem de `managed` alanını yöneten kişi.
    const managerUser = await makeActor({ homeAreaId: c.home.id });
    const managed = await makeArea({ managerId: managerUser.id });
    const { loadActor } = await import("../../src/lib/auth/guards");
    const me = (await loadActor(db, managerUser.id))!;
    expect(me.managedAreaIds).toContain(managed.id);

    const own = await poolTicket(c, c.home.id);
    const managedT = await poolTicket(c, managed.id);
    const other = await poolTicket(c, c.areaA.id);
    for (let i = 0; i < 15; i++) {
      const r = await requestTicket(db, me, T0);
      expect(r.kind).toBe("offered");
      if (r.kind === "offered") expect(r.offer.ticket.id).toBe(other.id);
      await resetToPool([other.id]);
    }
    expect((await ticketById(own.id)).status).toBe("available");
    expect((await ticketById(managedT.id)).status).toBe("available");
  });

  it("arşivli alanın ticket'ı gelmez", async () => {
    const c = await setupCycle();
    await poolTicket(c, c.areaA.id);
    await db.update(areas).set({ archivedAt: T0 }).where(eq(areas.id, c.areaA.id));
    expect((await requestTicket(db, c.member, T0)).kind).toBe("empty");
  });

  it("taslak ticket gelmez", async () => {
    const c = await setupCycle();
    await poolTicket(c, c.areaA.id, { status: "draft" });
    expect((await requestTicket(db, c.member, T0)).kind).toBe("empty");
  });

  it("ön koşulu bitmemiş ticket gelmez; ön koşul submitted/cancelled olunca gelir", async () => {
    for (const done of ["submitted", "cancelled"] as const) {
      await resetDb();
      const c = await setupCycle();
      const other = await makeMember(c.home.id);
      const pre = await takenTicket(c, c.areaA.id, other);
      const dep = await poolTicket(c, c.areaB.id);
      await db.insert(ticketDependencies).values({ ticketId: dep.id, dependsOnId: pre.id });
      expect((await requestTicket(db, c.member, T0)).kind).toBe("empty");
      await db.update(tickets).set({ status: done }).where(eq(tickets.id, pre.id));
      const r = await requestTicket(db, c.member, T0);
      expect(r.kind).toBe("offered");
      if (r.kind === "offered") expect(r.offer.ticket.id).toBe(dep.id);
    }
  });

  it("bu sprintte reddettiği ticket bir daha gelmez", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    const r = await requestTicket(db, c.member, T0);
    expect(r.kind).toBe("offered");
    await rejectOffer(db, c.member, { ticketId: t.id }, at(MIN));
    for (let i = 0; i < 5; i++) expect((await requestTicket(db, c.member, at(2 * MIN))).kind).toBe("empty");
    // Başkası yine alabilir.
    const other = await makeMember(c.home.id);
    expect((await requestTicket(db, other, at(2 * MIN))).kind).toBe("offered");
  });

  it("rastgelelik: birden çok aday varken farklı ticket'lar gelir", async () => {
    const c = await setupCycle();
    const ts = [];
    for (let i = 0; i < 5; i++) ts.push(await poolTicket(c, c.areaA.id));
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = await requestTicket(db, c.member, T0);
      if (r.kind === "offered") seen.add(r.offer.ticket.id);
      await resetToPool(ts.map((t) => t.id));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("requestTicket: eşzamanlılık", () => {
  it("8 üye aynı anda tek adaylı havuzdan ister: tek kişiye düşer, diğerleri empty", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    const members = [];
    for (let i = 0; i < 8; i++) members.push(await makeMember(c.home.id, `Üye ${i}`));
    const results = await Promise.all(members.map((m) => requestTicket(db, m, T0)));
    const offered = results.filter((r) => r.kind === "offered");
    const empty = results.filter((r) => r.kind === "empty");
    expect(offered).toHaveLength(1);
    expect(empty).toHaveLength(7);
    const winnerIdx = results.findIndex((r) => r.kind === "offered");
    const row = await ticketById(t.id);
    expect(row.status).toBe("offered");
    expect(row.assigneeId).toBe(members[winnerIdx]!.id);
  });

  it("8 üye, 3 ticket: 3 farklı ticket 3 farklı kişiye düşer", async () => {
    const c = await setupCycle();
    for (let i = 0; i < 3; i++) await poolTicket(c, c.areaA.id);
    const members = [];
    for (let i = 0; i < 8; i++) members.push(await makeMember(c.home.id, `Üye ${i}`));
    const results = await Promise.all(members.map((m) => requestTicket(db, m, T0)));
    const offered = results.flatMap((r) => (r.kind === "offered" ? [r.offer.ticket.id] : []));
    expect(offered).toHaveLength(3);
    expect(new Set(offered).size).toBe(3);
    expect(results.filter((r) => r.kind === "empty")).toHaveLength(5);
  });

  it("aynı üye aynı anda iki kez ister: tek teklif", async () => {
    const c = await setupCycle();
    for (let i = 0; i < 3; i++) await poolTicket(c, c.areaA.id);
    const [r1, r2] = await Promise.all([requestTicket(db, c.member, T0), requestTicket(db, c.member, T0)]);
    expect(r1.kind).toBe("offered");
    expect(r2.kind).toBe("offered");
    if (r1.kind === "offered" && r2.kind === "offered") expect(r1.offer.ticket.id).toBe(r2.offer.ticket.id);
    const mine = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.assigneeId, c.member.id), eq(tickets.status, "offered")));
    expect(mine).toHaveLength(1);
  });
});

describe("teklif yaşam döngüsü", () => {
  it("bekleyen teklif varken tekrar istemek aynı teklifi döndürür", async () => {
    const c = await setupCycle();
    for (let i = 0; i < 3; i++) await poolTicket(c, c.areaA.id);
    const r1 = await requestTicket(db, c.member, T0);
    const r2 = await requestTicket(db, c.member, at(5 * MIN));
    expect(r1.kind).toBe("offered");
    expect(r2.kind).toBe("offered");
    if (r1.kind === "offered" && r2.kind === "offered") {
      expect(r2.offer.ticket.id).toBe(r1.offer.ticket.id);
      expect(r2.offer.offeredAt).toBe(r1.offer.offeredAt);
      expect(r1.offer.expiresAt).toBe(at(30 * MIN).toISOString());
    }
  });

  it("süresi geçmiş teklif (31 dk) yeniden istemede hak düşmeden havuza döner", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    const r = await requestTicket(db, c.member, at(31 * MIN));
    // Tek ticket: süresi geçen teklif serbest kalıp yeniden (yeni anla) teklif edilebilir; hak düşmemiş olmalı.
    expect(r.rejections).toEqual({ used: 0, limit: 2, remaining: 2 });
    const row = await ticketById(t.id);
    if (r.kind === "offered") expect(row.offeredAt).toEqual(at(31 * MIN));
    expect(await db.select().from(ticketRejections)).toHaveLength(0);
    expect(await auditRows("ticket.offer_expired", t.id)).toHaveLength(1);
  });

  it("acceptOffer: başarıda taken + dueAt = now + 72 saat", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    await acceptOffer(db, c.member, { ticketId: t.id }, at(10 * MIN));
    const row = await ticketById(t.id);
    expect(row.status).toBe("taken");
    expect(row.assigneeId).toBe(c.member.id);
    expect(row.takenAt).toEqual(at(10 * MIN));
    expect(row.dueAt).toEqual(at(10 * MIN + 72 * H));
    expect(row.offeredAt).toBeNull();
    expect(await auditRows("ticket.offer_accept", t.id)).toHaveLength(1);
  });

  it("acceptOffer: başkasının teklifi INVALID_STATE", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    const other = await makeMember(c.home.id);
    await expectCode(acceptOffer(db, other, { ticketId: t.id }, at(MIN)), "INVALID_STATE");
    expect((await ticketById(t.id)).status).toBe("offered");
  });

  it("acceptOffer: süresi geçmiş teklif INVALID_STATE", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    await expectCode(acceptOffer(db, c.member, { ticketId: t.id }, at(31 * MIN)), "INVALID_STATE");
  });

  it("rejectOffer: başkasının teklifi INVALID_STATE", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    const other = await makeMember(c.home.id);
    await expectCode(rejectOffer(db, other, { ticketId: t.id }, at(MIN)), "INVALID_STATE");
  });
});

describe("red hakkı", () => {
  it("red: returned_to_pool, assignee null, kota azalır, ticket_rejections satırı, denetim", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    const q = await rejectOffer(db, c.member, { ticketId: t.id }, at(MIN));
    expect(q).toEqual({ used: 1, limit: 2, remaining: 1 });
    const row = await ticketById(t.id);
    expect(row.status).toBe("returned_to_pool");
    expect(row.assigneeId).toBeNull();
    expect(row.offeredAt).toBeNull();
    const rej = await db.select().from(ticketRejections);
    expect(rej).toHaveLength(1);
    expect(rej[0]).toMatchObject({ ticketId: t.id, userId: c.member.id, sprintId: c.sprint.id });
    expect(await auditRows("ticket.offer_reject", t.id)).toHaveLength(1);
  });

  it("2 retten sonra istek doğrudan taken döner (dueAt = now + ticketHours)", async () => {
    const c = await setupCycle();
    for (let i = 0; i < 3; i++) await poolTicket(c, c.areaA.id);
    for (let i = 0; i < 2; i++) {
      const r = await requestTicket(db, c.member, at(i * MIN));
      expect(r.kind).toBe("offered");
      if (r.kind === "offered") await rejectOffer(db, c.member, { ticketId: r.offer.ticket.id }, at(i * MIN + 1000));
    }
    const now = at(10 * MIN);
    const r = await requestTicket(db, c.member, now);
    expect(r.kind).toBe("taken");
    expect(r.rejections.remaining).toBe(0);
    if (r.kind === "taken") {
      const row = await ticketById(r.ticket.id);
      expect(row.status).toBe("taken");
      expect(row.assigneeId).toBe(c.member.id);
      expect(row.dueAt).toEqual(at(10 * MIN + 72 * H));
      expect(row.takenAt).toEqual(now);
      expect(row.offeredAt).toBeNull();
    }
    const draws = await auditRows("ticket.request_draw");
    expect(draws.length).toBeGreaterThanOrEqual(3);
  });

  it("hak 0 iken rejectOffer INVALID_STATE", async () => {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    for (let i = 0; i < 2; i++) {
      const old = await poolTicket(c, c.areaB.id);
      await db.insert(ticketRejections).values({ ticketId: old.id, userId: c.member.id, sprintId: c.sprint.id });
    }
    await db
      .update(tickets)
      .set({ status: "offered", assigneeId: c.member.id, offeredAt: T0 })
      .where(eq(tickets.id, t.id));
    await expectCode(rejectOffer(db, c.member, { ticketId: t.id }, at(MIN)), "INVALID_STATE");
    expect((await ticketById(t.id)).status).toBe("offered");
  });

  it("rejectOffer taken ticket için INVALID_STATE", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await expectCode(rejectOffer(db, c.member, { ticketId: t.id }, at(MIN)), "INVALID_STATE");
  });
});

describe("getMyTickets", () => {
  it("aktif sprint yokken sprint null", async () => {
    const c = await setupCycle();
    await db.execute(sql`update sprints set status = 'closed'`);
    const v = await getMyTickets(db, c.member, T0);
    expect(v.sprint).toBeNull();
    expect(v.offer).toBeNull();
  });

  it("sprint, kota, teklif, aktifler (en yakın bitiş önce) ve son teslimler", async () => {
    const c = await setupCycle();
    const late = await takenTicket(c, c.areaA.id, c.member, { dueAt: at(50 * H) });
    const soon = await takenTicket(c, c.areaB.id, c.member, { dueAt: at(5 * H) });
    const paused = await takenTicket(c, c.areaB.id, c.member, { status: "extension_pending", dueAt: at(20 * H), pausedAt: at(H) });
    const sub = await takenTicket(c, c.areaA.id, c.member, { status: "submitted" });
    await poolTicket(c, c.areaA.id);
    const draw = await requestTicket(db, c.member, T0);
    expect(draw.kind).toBe("offered");

    const v = await getMyTickets(db, c.member, at(MIN));
    expect(v.sprint).toEqual({ id: c.sprint.id, name: c.sprint.name });
    expect(v.rejections).toEqual({ used: 0, limit: 2, remaining: 2 });
    expect(v.offer?.expiresAt).toBe(at(30 * MIN).toISOString());
    expect(v.offer?.ticket.status).toBe("offered");
    expect(v.active.map((x) => x.id)).toEqual([soon.id, paused.id, late.id]);
    expect(v.active.find((x) => x.id === paused.id)?.countdown.pausedAt).toBe(at(H).toISOString());
    expect(v.active.find((x) => x.id === soon.id)).toMatchObject({ areaName: c.areaB.name, status: "taken" });
    expect(v.recent.map((x) => x.id)).toEqual([sub.id]);
  });

  it("süresi geçmiş teklif görünümde offer olarak gelmez", async () => {
    const c = await setupCycle();
    await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    expect((await getMyTickets(db, c.member, at(31 * MIN))).offer).toBeNull();
  });
});

describe("denetim", () => {
  it("ticket.request_draw (offered / empty)", async () => {
    const c = await setupCycle();
    expect((await requestTicket(db, c.member, T0)).kind).toBe("empty");
    const t = await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    const rows = await auditRows("ticket.request_draw");
    expect(rows.map((r) => (r.data as { kind: string }).kind).sort()).toEqual(["empty", "offered"]);
    expect(rows.find((r) => r.entityId === t.id)?.actorId).toBe(c.member.id);
  });
});

void makeManagerActor;
