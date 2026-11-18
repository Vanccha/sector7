import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ticketDependencies, tickets } from "../../src/db/schema";
import { takeableCondition } from "../../src/server/dependencies";
import {
  cancelTicket,
  createTicket,
  createTicketsFromSteps,
  listAreaTickets,
  publishTickets,
  updateTicket,
} from "../../src/server/tickets";
import { db, makeActiveSprint, makeArea, makeMainAdmin, resetDb } from "../helpers/db";
import { expectCode } from "../helpers/errors";
import { auditRows, getTicket, makeManagerActor, makeTicketRow, setupApprovedRoadmap } from "../helpers/plan";

async function setup(status: "approved" | "draft" | "submitted" = "approved") {
  const sprint = await makeActiveSprint();
  const m = await makeManagerActor();
  const rm = await setupApprovedRoadmap({ areaId: m.area.id, sprintId: sprint.id, status });
  return { sprint, m, ...rm };
}

const dep = (ticketId: string, dependsOnId: string) =>
  db.insert(ticketDependencies).values({ ticketId, dependsOnId });

describe("createTicket", () => {
  beforeEach(resetDb);

  it("roadmap onaylı değilken INVALID_STATE", async () => {
    for (const st of ["draft", "submitted", "returned"] as const) {
      await resetDb();
      const { m, steps } = await setup(st as "draft");
      await expectCode(createTicket(db, m.actor, { roadmapStepId: steps[0]!.id }), "INVALID_STATE");
    }
  });

  it("onaylıyken taslak ticket; alan/sprint roadmap'ten, başlık boşsa basamaktan", async () => {
    const { sprint, m, steps } = await setup();
    const { id } = await createTicket(db, m.actor, { roadmapStepId: steps[0]!.id });
    const t = await getTicket(id);
    expect(t).toMatchObject({
      status: "draft",
      areaId: m.area.id,
      sprintId: sprint.id,
      roadmapStepId: steps[0]!.id,
      title: steps[0]!.title,
      description: steps[0]!.description,
    });
    const { id: id2 } = await createTicket(db, m.actor, { roadmapStepId: steps[1]!.id, title: "Özel başlık" });
    expect((await getTicket(id2)).title).toBe("Özel başlık");
    expect(await auditRows("ticket.create", id)).toHaveLength(1);
  });

  it("başka alanın yöneticisi oluşturamaz", async () => {
    const { steps } = await setup();
    const other = await makeManagerActor();
    await expectCode(createTicket(db, other.actor, { roadmapStepId: steps[0]!.id }), "FORBIDDEN");
  });
});

describe("createTicketsFromSteps", () => {
  beforeEach(resetDb);

  it("yalnız ticket'ı olmayan basamaklar için oluşturur; ikinci çağrı 0", async () => {
    const { m, roadmap, steps } = await setup();
    await createTicket(db, m.actor, { roadmapStepId: steps[0]!.id });
    await expect(createTicketsFromSteps(db, m.actor, { roadmapId: roadmap.id })).resolves.toEqual({ created: 1 });
    await expect(createTicketsFromSteps(db, m.actor, { roadmapId: roadmap.id })).resolves.toEqual({ created: 0 });
    expect(await db.select().from(tickets).where(eq(tickets.areaId, m.area.id))).toHaveLength(2);
  });

  it("roadmap onaylı değilken INVALID_STATE", async () => {
    const { m, roadmap } = await setup("draft");
    await expectCode(createTicketsFromSteps(db, m.actor, { roadmapId: roadmap.id }), "INVALID_STATE");
  });
});

describe("publishTickets", () => {
  beforeEach(resetDb);

  it("draft -> available", async () => {
    const { sprint, m } = await setup();
    const a = await makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id });
    const b = await makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id });
    await expect(publishTickets(db, m.actor, { ticketIds: [a.id, b.id] })).resolves.toEqual({ published: 2 });
    expect((await getTicket(a.id)).status).toBe("available");
    expect((await getTicket(b.id)).status).toBe("available");
    expect(await auditRows("ticket.publish")).toHaveLength(2);
  });

  it("içinde draft olmayan varsa hiçbiri değişmez", async () => {
    const { sprint, m } = await setup();
    const a = await makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id });
    const b = await makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id, status: "available" });
    await expectCode(publishTickets(db, m.actor, { ticketIds: [a.id, b.id] }), "INVALID_STATE");
    expect((await getTicket(a.id)).status).toBe("draft");
  });

  it("başka alanın yöneticisi yayınlayamaz; ana yönetici yayınlayabilir", async () => {
    const { sprint, m } = await setup();
    const other = await makeManagerActor();
    const admin = await makeMainAdmin();
    const a = await makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id });
    await expectCode(publishTickets(db, other.actor, { ticketIds: [a.id] }), "FORBIDDEN");
    expect((await getTicket(a.id)).status).toBe("draft");
    await publishTickets(db, admin, { ticketIds: [a.id] });
    expect((await getTicket(a.id)).status).toBe("available");
  });
});

describe("updateTicket / cancelTicket", () => {
  beforeEach(resetDb);

  it("draft/available/returned_to_pool düzenlenir ve iptal edilir", async () => {
    const { sprint, m } = await setup();
    for (const st of ["draft", "available", "returned_to_pool"] as const) {
      const t = await makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id, status: st });
      await updateTicket(db, m.actor, { ticketId: t.id, title: "Yeni başlık", description: "d" });
      expect((await getTicket(t.id)).title).toBe("Yeni başlık");
      await cancelTicket(db, m.actor, { ticketId: t.id });
      expect((await getTicket(t.id)).status).toBe("cancelled");
    }
  });

  it("taken ve diğer durumlar INVALID_STATE", async () => {
    const { sprint, m } = await setup();
    for (const st of ["taken", "submitted", "evaluated", "extension_pending", "withdrawal_pending", "cancelled"] as const) {
      const t = await makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id, status: st });
      await expectCode(updateTicket(db, m.actor, { ticketId: t.id, title: "Yeni başlık" }), "INVALID_STATE");
      await expectCode(cancelTicket(db, m.actor, { ticketId: t.id }), "INVALID_STATE");
      expect((await getTicket(t.id)).status).toBe(st);
    }
  });

  it("başka alanın yöneticisi düzenleyemez/iptal edemez", async () => {
    const { sprint, m } = await setup();
    const other = await makeManagerActor();
    const t = await makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id });
    await expectCode(updateTicket(db, other.actor, { ticketId: t.id, title: "Çalma" }), "FORBIDDEN");
    await expectCode(cancelTicket(db, other.actor, { ticketId: t.id }), "FORBIDDEN");
  });
});

describe("listAreaTickets: takeable / blockedBy", () => {
  beforeEach(resetDb);

  async function pair(prereqStatus: string, waitingStatus = "available") {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const pre = await makeTicketRow({
      areaId: m.area.id,
      sprintId: sprint.id,
      createdById: m.user.id,
      status: prereqStatus as "available",
    });
    const waiting = await makeTicketRow({
      areaId: m.area.id,
      sprintId: sprint.id,
      createdById: m.user.id,
      status: waitingStatus as "available",
    });
    await dep(waiting.id, pre.id);
    const view = await listAreaTickets(db, m.actor, { areaId: m.area.id, sprintId: sprint.id });
    return { view, pre, waiting, m, sprint };
  }

  it("ön koşul available iken bağımlı kilitli", async () => {
    const { view, pre, waiting } = await pair("available");
    const w = view.tickets.find((t) => t.id === waiting.id)!;
    expect(w.takeable).toBe(false);
    expect(w.blockedBy.map((b) => b.id)).toEqual([pre.id]);
    expect(w.prerequisites).toHaveLength(1);
    expect(view.tickets.find((t) => t.id === pre.id)!.takeable).toBe(true);
  });

  it.each(["submitted", "evaluated", "cancelled"])("ön koşul %s olunca bağımlı takeable", async (st) => {
    const { view, waiting } = await pair(st);
    const w = view.tickets.find((t) => t.id === waiting.id)!;
    expect(w.blockedBy).toEqual([]);
    expect(w.takeable).toBe(true);
  });

  it.each(["taken", "draft", "extension_pending", "withdrawal_pending", "returned_to_pool"])(
    "ön koşul %s hâlâ engeller",
    async (st) => {
      const { view, waiting } = await pair(st);
      const w = view.tickets.find((t) => t.id === waiting.id)!;
      expect(w.takeable).toBe(false);
      expect(w.blockedBy).toHaveLength(1);
    },
  );

  it("draft bağımlı ön koşulları bitse de takeable değil; taken bağımlı da değil", async () => {
    const d = await pair("evaluated", "draft");
    expect(d.view.tickets.find((t) => t.id === d.waiting.id)!.takeable).toBe(false);
    await resetDb();
    const k = await pair("evaluated", "taken");
    expect(k.view.tickets.find((t) => t.id === k.waiting.id)!.takeable).toBe(false);
  });

  it("returned_to_pool bağımlı ön koşulları bittiyse takeable", async () => {
    const { view, waiting } = await pair("submitted", "returned_to_pool");
    expect(view.tickets.find((t) => t.id === waiting.id)!.takeable).toBe(true);
  });

  it("dış alan ön koşulu externalPrerequisites'te", async () => {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const otherArea = await makeArea({ name: "Dış alan" });
    const ext = await makeTicketRow({
      areaId: otherArea.id,
      sprintId: sprint.id,
      createdById: m.user.id,
      status: "available",
    });
    const waiting = await makeTicketRow({
      areaId: m.area.id,
      sprintId: sprint.id,
      createdById: m.user.id,
      status: "available",
    });
    await dep(waiting.id, ext.id);
    const view = await listAreaTickets(db, m.actor, { areaId: m.area.id, sprintId: sprint.id });
    expect(view.externalPrerequisites.map((e) => e.id)).toEqual([ext.id]);
    expect(view.externalPrerequisites[0]).toMatchObject({ areaId: otherArea.id, areaName: "Dış alan" });
    expect(view.tickets.map((t) => t.id)).not.toContain(ext.id);
  });

  it("başka alanın yöneticisi listeleyemez; canEdit doğru", async () => {
    const { m, sprint } = await pair("available");
    const other = await makeManagerActor();
    await expectCode(listAreaTickets(db, other.actor, { areaId: m.area.id, sprintId: sprint.id }), "FORBIDDEN");
    expect((await listAreaTickets(db, m.actor, { areaId: m.area.id, sprintId: sprint.id })).canEdit).toBe(true);
  });

  it("takeableCondition() doğrudan sorgusu listAreaTickets ile aynı sonucu verir", async () => {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const mk = (status: string) =>
      makeTicketRow({ areaId: m.area.id, sprintId: sprint.id, createdById: m.user.id, status: status as "available" });
    const free = await mk("available");
    const pre1 = await mk("available");
    const blocked = await mk("available");
    const pre2 = await mk("submitted");
    const unblocked = await mk("returned_to_pool");
    const pre3 = await mk("taken");
    const stillBlocked = await mk("available");
    const draft = await mk("draft");
    const pre4 = await mk("cancelled");
    const cancelledPre = await mk("available");
    await dep(blocked.id, pre1.id);
    await dep(unblocked.id, pre2.id);
    await dep(stillBlocked.id, pre3.id);
    await dep(draft.id, pre4.id);
    await dep(cancelledPre.id, pre4.id);

    const view = await listAreaTickets(db, m.actor, { areaId: m.area.id, sprintId: sprint.id });
    const viaList = view.tickets.filter((t) => t.takeable).map((t) => t.id).sort();
    const viaSql = (await db.select({ id: tickets.id }).from(tickets).where(takeableCondition()))
      .map((r) => r.id)
      .sort();
    expect(viaSql).toEqual(viaList);
    expect(viaSql).toEqual([free.id, pre1.id, unblocked.id, cancelledPre.id].sort());
  });
});
