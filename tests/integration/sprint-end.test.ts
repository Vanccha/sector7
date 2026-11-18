import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sprintEndDecisions, sprints, ticketRequests, tickets } from "../../src/db/schema";
import { AppError } from "../../src/lib/contracts/errors";
import { requestTicket } from "../../src/server/pool";
import { beginSprintClose, closeSprint, decideSprintEnd, getSprintEndView } from "../../src/server/sprint-end";
import { startSprint } from "../../src/server/sprints";
import { createRequest } from "../../src/server/ticket-requests";
import { db, makeActiveSprint, resetDb } from "../helpers/db";
import { H, MIN, SEC, at, makeMember, poolTicket, setupCycle, takenTicket, ticketById, T0 } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { auditRows, makeTicketRow } from "../helpers/plan";

beforeEach(resetDb);

async function setup(withNext = true) {
  const c = await setupCycle();
  const next = withNext ? await makeActiveSprint({ number: 2, name: "Sprint 2", status: "planned" }) : null;
  return { c, next };
}

const decide = (c: Awaited<ReturnType<typeof setupCycle>>, who: typeof c.admin, ticketId: string, decision: string, now = at(H)) =>
  decideSprintEnd(db, who, { sprintId: c.sprint.id, ticketId, decision }, now);

async function expectAppError(p: Promise<unknown>) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AppError);
}

describe("beginSprintClose", () => {
  it("yalnız ana yönetici; alan yöneticisi ve üye FORBIDDEN", async () => {
    const { c } = await setup();
    await expectCode(beginSprintClose(db, c.mgrA, { sprintId: c.sprint.id }, T0), "FORBIDDEN");
    await expectCode(beginSprintClose(db, c.member, { sprintId: c.sprint.id }, T0), "FORBIDDEN");
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    const [s] = await db.select().from(sprints).where(eq(sprints.id, c.sprint.id));
    expect(s!.status).toBe("closing");
    expect(await auditRows("sprint.close_begin", c.sprint.id)).toHaveLength(1);
  });

  it("yalnız active sprint: planned ve closing için INVALID_STATE", async () => {
    const { c, next } = await setup();
    await expectCode(beginSprintClose(db, c.admin, { sprintId: next!.id }, T0), "INVALID_STATE");
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await expectCode(beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0), "INVALID_STATE");
  });

  it("offered ticket'lar havuza döner", async () => {
    const { c } = await setup();
    await poolTicket(c, c.areaA.id);
    const r = await requestTicket(db, c.member, T0);
    expect(r.kind).toBe("offered");
    const id = r.kind === "offered" ? r.offer.ticket.id : "";
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, at(MIN));
    const t = await ticketById(id);
    expect(t).toMatchObject({ status: "returned_to_pool", assigneeId: null, offeredAt: null });
  });

  it("closing sprint havuzda değildir", async () => {
    const { c } = await setup();
    await poolTicket(c, c.areaA.id);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await expectCode(requestTicket(db, c.member, T0), "INVALID_STATE");
  });
});

describe("bitmemiş listesi (getSprintEndView)", () => {
  it("taslak dahil; submitted/evaluated/cancelled hariç", async () => {
    const { c } = await setup();
    const draft = await poolTicket(c, c.areaA.id, { status: "draft" });
    const avail = await poolTicket(c, c.areaA.id);
    const taken = await takenTicket(c, c.areaA.id, c.member);
    const pend = await takenTicket(c, c.areaB.id, c.member, { status: "extension_pending", pausedAt: T0 });
    const sub = await takenTicket(c, c.areaA.id, c.member, { status: "submitted" });
    const ev = await takenTicket(c, c.areaA.id, c.member, { status: "evaluated" });
    const can = await takenTicket(c, c.areaA.id, c.member, { status: "cancelled" });
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    const v = await getSprintEndView(db, c.admin, { sprintId: c.sprint.id }, at(H));
    const ids = v.items.map((i) => i.ticket.id).sort();
    expect(ids).toEqual([draft.id, avail.id, taken.id, pend.id].sort());
    for (const x of [sub.id, ev.id, can.id]) expect(ids).not.toContain(x);
    expect(v.undecidedTotal).toBe(4);
    expect(v.canClose).toBe(false);
    expect(v.nextSprint?.name).toBe("Sprint 2");
    const draftItem = v.items.find((i) => i.ticket.id === draft.id)!;
    expect(draftItem.allowedOptions.sort()).toEqual(["cancel", "move_next"]);
    const takenItem = v.items.find((i) => i.ticket.id === taken.id)!;
    expect(takenItem.allowedOptions.sort()).toEqual(["cancel", "keep_assignee", "move_next", "return_pool"]);
    expect(takenItem.canDecide).toBe(true);
  });

  it("sprint kapanışta değilken INVALID_STATE", async () => {
    const { c } = await setup();
    await expectCode(getSprintEndView(db, c.admin, { sprintId: c.sprint.id }, T0), "INVALID_STATE");
  });

  it("alan yöneticisi yalnız kendi alanlarını görür; üye FORBIDDEN", async () => {
    const { c } = await setup();
    const ta = await takenTicket(c, c.areaA.id, c.member);
    const tb = await takenTicket(c, c.areaB.id, c.member);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    const a = await getSprintEndView(db, c.mgrA, { sprintId: c.sprint.id }, at(H));
    expect(a.items.map((i) => i.ticket.id)).toEqual([ta.id]);
    expect(a.undecidedTotal).toBe(2);
    expect(a.canClose).toBe(false);
    const b = await getSprintEndView(db, c.mgrB, { sprintId: c.sprint.id }, at(H));
    expect(b.items.map((i) => i.ticket.id)).toEqual([tb.id]);
    await expectCode(getSprintEndView(db, c.member, { sprintId: c.sprint.id }, at(H)), "FORBIDDEN");
  });

  it("sonraki sprint yokken needsNextSprint seçenekleri izinli listede yok", async () => {
    const { c } = await setup(false);
    const t = await takenTicket(c, c.areaA.id, c.member);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    const v = await getSprintEndView(db, c.admin, { sprintId: c.sprint.id }, at(H));
    expect(v.nextSprint).toBeNull();
    expect(v.items.find((i) => i.ticket.id === t.id)!.allowedOptions).toEqual(["cancel"]);
  });
});

describe("kararlar: sonraki sprint yokken", () => {
  it("move_next / keep_assignee / return_pool INVALID_STATE, cancel çalışır", async () => {
    const { c } = await setup(false);
    const t = await takenTicket(c, c.areaA.id, c.member);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    for (const d of ["move_next", "keep_assignee", "return_pool"]) {
      await expectCode(decide(c, c.admin, t.id, d), "INVALID_STATE");
    }
    expect(await db.select().from(sprintEndDecisions)).toHaveLength(0);
    await decide(c, c.admin, t.id, "cancel");
    expect((await ticketById(t.id)).status).toBe("cancelled");
  });
});

describe("kararlar: planlı sprint varken", () => {
  it("move_next: sprintId değişir, durum aynı kalır", async () => {
    const { c, next } = await setup();
    const taken = await takenTicket(c, c.areaA.id, c.member);
    const avail = await poolTicket(c, c.areaA.id);
    const draft = await poolTicket(c, c.areaA.id, { status: "draft" });
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    for (const t of [taken, avail, draft]) await decide(c, c.mgrA, t.id, "move_next");
    for (const [t, st] of [[taken, "taken"], [avail, "available"], [draft, "draft"]] as const) {
      const row = await ticketById(t.id);
      expect(row.sprintId).toBe(next!.id);
      expect(row.status).toBe(st);
    }
    expect((await ticketById(taken.id)).assigneeId).toBe(c.member.id);
    expect(await auditRows("sprint.end_decision", taken.id)).toHaveLength(1);
  });

  it("keep_assignee: dueAt = now + ticketHours, işaretler null, kişi aynı", async () => {
    const { c, next } = await setup();
    const t = await takenTicket(c, c.areaA.id, c.member, { warnedAt: T0, expiredNotifiedAt: T0 });
    const pend = await takenTicket(c, c.areaA.id, c.member, { status: "extension_pending", pausedAt: T0 });
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await decide(c, c.mgrA, t.id, "keep_assignee", at(5 * H));
    await decide(c, c.mgrA, pend.id, "keep_assignee", at(5 * H));
    const row = await ticketById(t.id);
    expect(row).toMatchObject({ sprintId: next!.id, status: "taken", assigneeId: c.member.id, warnedAt: null, expiredNotifiedAt: null });
    expect(row.dueAt).toEqual(at(5 * H + 72 * H));
    const p = await ticketById(pend.id);
    expect(p.status).toBe("extension_pending");
    expect(p.sprintId).toBe(next!.id);
    expect(p.dueAt).toEqual(at(5 * H + 72 * H));
  });

  it("keep_assignee taslağa / havuzdakine VALIDATION", async () => {
    const { c } = await setup();
    const draft = await poolTicket(c, c.areaA.id, { status: "draft" });
    const avail = await poolTicket(c, c.areaA.id);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await expectCode(decide(c, c.mgrA, draft.id, "keep_assignee"), "VALIDATION");
    await expectCode(decide(c, c.mgrA, avail.id, "return_pool"), "VALIDATION");
    expect(await db.select().from(sprintEndDecisions)).toHaveLength(0);
  });

  it("return_pool: bekleyen talep cancelled, assignee null, returned_to_pool, sprintId sonraki", async () => {
    const { c, next } = await setup();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(SEC));
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, at(H));
    await decide(c, c.mgrA, t.id, "return_pool");
    const row = await ticketById(t.id);
    expect(row).toMatchObject({ status: "returned_to_pool", assigneeId: null, sprintId: next!.id, dueAt: null, pausedAt: null });
    const [r] = await db.select().from(ticketRequests).where(eq(ticketRequests.id, id));
    expect(r!.status).toBe("cancelled");
  });

  it("cancel: bekleyen talep cancelled, ticket cancelled", async () => {
    const { c } = await setup();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "withdrawal", reason: "Yapamayacağım" }, at(SEC));
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, at(H));
    await decide(c, c.admin, t.id, "cancel");
    const row = await ticketById(t.id);
    expect(row.status).toBe("cancelled");
    expect(row.pausedAt).toBeNull();
    const [r] = await db.select().from(ticketRequests).where(eq(ticketRequests.id, id));
    expect(r!.status).toBe("cancelled");
  });

  it("aynı ticket'a ikinci karar hata verir", async () => {
    const { c } = await setup();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const u = await takenTicket(c, c.areaA.id, c.member);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await decide(c, c.mgrA, t.id, "cancel");
    await expectAppError(decide(c, c.mgrA, t.id, "cancel"));
    await decide(c, c.mgrA, u.id, "move_next");
    await expectAppError(decide(c, c.admin, u.id, "cancel"));
    expect(await db.select().from(sprintEndDecisions)).toHaveLength(2);
  });

  it("aynı ticket'a eşzamanlı iki karar: yalnız biri uygulanır", async () => {
    const { c } = await setup();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    const rs = await Promise.allSettled([decide(c, c.mgrA, t.id, "move_next"), decide(c, c.admin, t.id, "cancel")]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(sprintEndDecisions)).toHaveLength(1);
  });

  it("alan yöneticisi yalnız kendi alanına karar verir; üye veremez", async () => {
    const { c } = await setup();
    const tb = await takenTicket(c, c.areaB.id, c.member);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await expectCode(decide(c, c.mgrA, tb.id, "move_next"), "FORBIDDEN");
    await expectCode(decide(c, c.member, tb.id, "move_next"), "FORBIDDEN");
    await decide(c, c.mgrB, tb.id, "move_next");
    expect((await ticketById(tb.id)).status).toBe("taken");
  });

  it("bilinmeyen seçenek VALIDATION; sprint closing değilken INVALID_STATE", async () => {
    const { c } = await setup();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await expectCode(decide(c, c.admin, t.id, "cancel"), "INVALID_STATE");
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await expectCode(decide(c, c.admin, t.id, "yok_boyle_bir_sey"), "VALIDATION");
  });

  it("kişiyi etkileyen karar assignee'ye bildirim yazar", async () => {
    const { c } = await setup();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await decide(c, c.mgrA, t.id, "return_pool");
    const { notifsOf } = await import("../helpers/cycle");
    expect((await notifsOf(c.member.id)).length).toBeGreaterThan(0);
  });
});

describe("closeSprint", () => {
  it("kararsız varken INVALID_STATE; hepsi bitince closed + closedAt", async () => {
    const { c } = await setup();
    const t1 = await takenTicket(c, c.areaA.id, c.member);
    const t2 = await takenTicket(c, c.areaB.id, c.member);
    await takenTicket(c, c.areaA.id, c.member, { status: "submitted" });
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await expectCode(closeSprint(db, c.admin, { sprintId: c.sprint.id }, at(H)), "INVALID_STATE");
    await decide(c, c.mgrA, t1.id, "move_next");
    await expectCode(closeSprint(db, c.admin, { sprintId: c.sprint.id }, at(H)), "INVALID_STATE");
    await decide(c, c.mgrB, t2.id, "cancel");

    const v = await getSprintEndView(db, c.admin, { sprintId: c.sprint.id }, at(H));
    expect(v.undecidedTotal).toBe(0);
    expect(v.canClose).toBe(true);
    await expectCode(closeSprint(db, c.mgrA, { sprintId: c.sprint.id }, at(2 * H)), "FORBIDDEN");
    await closeSprint(db, c.admin, { sprintId: c.sprint.id }, at(2 * H));
    const [s] = await db.select().from(sprints).where(eq(sprints.id, c.sprint.id));
    expect(s!.status).toBe("closed");
    expect(s!.closedAt).toEqual(at(2 * H));
    expect(await auditRows("sprint.close", c.sprint.id)).toHaveLength(1);
  });

  it("closing değilken INVALID_STATE", async () => {
    const { c } = await setup();
    await expectCode(closeSprint(db, c.admin, { sprintId: c.sprint.id }, T0), "INVALID_STATE");
  });

  it("closing sırasında yeni sprint başlatılabilir; havuz yeni aktif sprintten çeker", async () => {
    const { c, next } = await setup();
    const old = await poolTicket(c, c.areaA.id);
    const moved = await poolTicket(c, c.areaA.id);
    const draftOld = await makeTicketRow({ areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "draft" });
    await beginSprintClose(db, c.admin, { sprintId: c.sprint.id }, T0);
    await startSprint(db, c.admin, { sprintId: next!.id });
    const [s2] = await db.select().from(sprints).where(eq(sprints.id, next!.id));
    expect(s2!.status).toBe("active");

    // Havuzda yalnız yeni sprinte taşınan ticket var; eski sprintte kalan çekilemez.
    const other = await makeMember(c.home.id);
    expect((await requestTicket(db, other, at(H))).kind).toBe("empty");
    await decide(c, c.mgrA, moved.id, "move_next", at(H));
    const r = await requestTicket(db, c.member, at(2 * H));
    expect(r.kind).toBe("offered");
    if (r.kind === "offered") expect(r.offer.ticket.id).toBe(moved.id);
    expect((await ticketById(old.id)).status).toBe("available");
    expect((await ticketById(draftOld.id)).sprintId).toBe(c.sprint.id);
    // Hedef artık aktif sprint.
    const v = await getSprintEndView(db, c.admin, { sprintId: c.sprint.id }, at(3 * H));
    expect(v.nextSprint?.id).toBe(next!.id);
    void tickets;
  });
});
