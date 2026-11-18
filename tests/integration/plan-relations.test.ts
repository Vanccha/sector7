import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { areas, roadmapSteps, sprints, ticketDependencies, tickets } from "../../src/db/schema";
import { getAreaPlan, setStepRelation } from "../../src/server/plan";
import { addDependency, removeDependency } from "../../src/server/dependencies";
import { cancelTicket, createTicketsFromSteps, listAreaTickets, publishTickets } from "../../src/server/tickets";
import { requestTicket } from "../../src/server/pool";
import { submitTicket } from "../../src/server/delivery";
import { db, resetDb } from "../helpers/db";
import { at, makeMember, resetToPool, setupCycle, ticketById, T0 } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { auditRows, getRoadmap, makeTicketRow, setupApprovedRoadmap } from "../helpers/plan";

beforeEach(resetDb);

const edges = () => db.select().from(ticketDependencies);

/** Alan A'da onaylı roadmap; basamak i için flags[i] = afterPrevious. */
async function roadmapWith(flags: boolean[]) {
  const c = await setupCycle();
  const { roadmap, steps } = await setupApprovedRoadmap({
    areaId: c.areaA.id,
    sprintId: c.sprint.id,
    stepTitles: flags.map((_, i) => `Basamak ${"ABCDEFGH"[i]}`),
  });
  for (const [i, f] of flags.entries()) {
    await db.update(roadmapSteps).set({ afterPrevious: f }).where(eq(roadmapSteps.id, steps[i]!.id));
  }
  return { c, roadmap, steps };
}

async function ticketOfStep(stepId: string) {
  const rows = await db.select().from(tickets).where(eq(tickets.roadmapStepId, stepId));
  return rows;
}

describe("setStepRelation: yetki", () => {
  it("alan yöneticisi ve ana yönetici yapabilir", async () => {
    const { c, steps } = await roadmapWith([false, false]);
    await setStepRelation(db, c.mgrA, { stepId: steps[1]!.id, afterPrevious: true });
    expect((await db.select().from(roadmapSteps).where(eq(roadmapSteps.id, steps[1]!.id)))[0]!.afterPrevious).toBe(true);
    await setStepRelation(db, c.admin, { stepId: steps[1]!.id, afterPrevious: false });
    expect((await db.select().from(roadmapSteps).where(eq(roadmapSteps.id, steps[1]!.id)))[0]!.afterPrevious).toBe(false);
  });

  it("başka alanın yöneticisi, üye FORBIDDEN; oturumsuz UNAUTHENTICATED; değer değişmez", async () => {
    const { c, steps } = await roadmapWith([false, false]);
    const input = { stepId: steps[1]!.id, afterPrevious: true };
    await expectCode(setStepRelation(db, c.mgrB, input), "FORBIDDEN");
    await expectCode(setStepRelation(db, c.member, input), "FORBIDDEN");
    await expectCode(setStepRelation(db, null, input), "UNAUTHENTICATED");
    expect((await db.select().from(roadmapSteps).where(eq(roadmapSteps.id, steps[1]!.id)))[0]!.afterPrevious).toBe(false);
    expect(await auditRows("roadmap.step_relation")).toHaveLength(0);
  });

  it("arşivli alanda ve kapalı sprintte INVALID_STATE", async () => {
    const { c, steps } = await roadmapWith([false, false]);
    const input = { stepId: steps[1]!.id, afterPrevious: true };
    await db.update(sprints).set({ status: "closed" }).where(eq(sprints.id, c.sprint.id));
    await expectCode(setStepRelation(db, c.mgrA, input), "INVALID_STATE");
    await db.update(sprints).set({ status: "active" }).where(eq(sprints.id, c.sprint.id));
    await db.update(areas).set({ archivedAt: new Date() }).where(eq(areas.id, c.areaA.id));
    await expectCode(setStepRelation(db, c.mgrA, input), "INVALID_STATE");
    expect(await auditRows("roadmap.step_relation")).toHaveLength(0);
  });
});

describe("setStepRelation: davranış", () => {
  it("değer aynıysa no-op: denetim yok, roadmap onaylı kalır", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, true]);
    await setStepRelation(db, c.mgrA, { stepId: steps[1]!.id, afterPrevious: true });
    expect(await auditRows("roadmap.step_relation")).toHaveLength(0);
    expect((await getRoadmap(roadmap.id)).status).toBe("approved");
  });

  it("değişirse roadmap submitted olur, roadmap.step_relation yazılır", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, false]);
    await setStepRelation(db, c.mgrA, { stepId: steps[1]!.id, afterPrevious: true });
    expect((await getRoadmap(roadmap.id)).status).toBe("submitted");
    const rows = await auditRows("roadmap.step_relation", steps[1]!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(c.mgrA.id);
  });

  it("mevcut ticket bağımlılıklarına dokunmaz", async () => {
    const { c, steps } = await roadmapWith([false, true]);
    await createTicketsFromSteps(db, c.mgrA, { roadmapId: steps[0]!.roadmapId });
    expect(await edges()).toHaveLength(1);
    await setStepRelation(db, c.mgrA, { stepId: steps[1]!.id, afterPrevious: false });
    expect(await edges()).toHaveLength(1);
  });

  it("geçersiz girdi reddedilir", async () => {
    const { c } = await roadmapWith([false]);
    await expect(setStepRelation(db, c.mgrA, { stepId: "x", afterPrevious: true })).rejects.toThrow();
    await expect(setStepRelation(db, c.mgrA, { stepId: crypto.randomUUID(), afterPrevious: "evet" })).rejects.toThrow();
  });
});

describe("StepRow: afterPrevious ve ticket", () => {
  it("afterPrevious doğru; ticket yoksa null", async () => {
    const { c, steps } = await roadmapWith([false, true, false]);
    const plan = await getAreaPlan(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id });
    expect(plan.roadmap.steps.map((s) => s.afterPrevious)).toEqual([false, true, false]);
    expect(plan.roadmap.steps.every((s) => s.ticket === null)).toBe(true);
    expect(plan.roadmap.steps.map((s) => s.id)).toEqual(steps.map((s) => s.id));
  });

  it("ticket: durum, takeable, blockedCount; iptal edilen yok sayılır", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, true, false]);
    await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    const [ta, tb, tc] = [
      (await ticketOfStep(steps[0]!.id))[0]!,
      (await ticketOfStep(steps[1]!.id))[0]!,
      (await ticketOfStep(steps[2]!.id))[0]!,
    ];
    await publishTickets(db, c.mgrA, { ticketIds: [ta.id, tb.id] });
    let plan = await getAreaPlan(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id });
    const [sa, sb, sc] = plan.roadmap.steps;
    expect(sa!.ticket).toEqual({ id: ta.id, status: "available", takeable: true, blockedCount: 0 });
    expect(sb!.ticket).toEqual({ id: tb.id, status: "available", takeable: false, blockedCount: 1 });
    expect(sc!.ticket).toEqual({ id: tc.id, status: "draft", takeable: false, blockedCount: 0 });

    // A teslim edilince B alınabilir
    await db.update(tickets).set({ status: "submitted" }).where(eq(tickets.id, ta.id));
    plan = await getAreaPlan(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id });
    expect(plan.roadmap.steps[1]!.ticket).toEqual({ id: tb.id, status: "available", takeable: true, blockedCount: 0 });

    // C iptal edilir, yeni ticket aynı basamağa: o görünür
    await cancelTicket(db, c.mgrA, { ticketId: tc.id });
    plan = await getAreaPlan(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id });
    expect(plan.roadmap.steps[2]!.ticket).toBeNull();
    const t2 = await makeTicketRow({
      areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, roadmapStepId: steps[2]!.id, status: "draft",
    });
    plan = await getAreaPlan(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id });
    expect(plan.roadmap.steps[2]!.ticket?.id).toBe(t2.id);
  });
});

describe("StepRow.ticket.blockedCount (gerileme)", () => {
  it("2 ön koşuldan biri bitince blockedCount 2 -> 1 -> 0", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, false, true]);
    await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    const [ta, tb, tc] = await Promise.all(steps.map(async (s) => (await ticketOfStep(s.id))[0]!));
    await addDependency(db, c.mgrA, { ticketId: tc!.id, dependsOnId: tb!.id });
    await db.update(tickets).set({ status: "available" }).where(eq(tickets.roadmapStepId, steps[2]!.id));
    const info = async () =>
      (await getAreaPlan(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id })).roadmap.steps[2]!.ticket;
    // tc: ön koşulları tb (elle) ve ... otomatik bağlantı yalnız tb'ye (önceki basamak); ta'yı elle ekle.
    await addDependency(db, c.mgrA, { ticketId: tc!.id, dependsOnId: ta!.id }).catch(() => {});
    expect(await info()).toMatchObject({ status: "available", takeable: false, blockedCount: 2 });
    await db.update(tickets).set({ status: "submitted" }).where(eq(tickets.id, ta!.id));
    expect(await info()).toMatchObject({ takeable: false, blockedCount: 1 });
    await db.update(tickets).set({ status: "submitted" }).where(eq(tickets.id, tb!.id));
    expect(await info()).toMatchObject({ takeable: true, blockedCount: 0 });
  });
});

describe("createTicketsFromSteps: sıralı bağlantılar", () => {
  it("A, B(true), C(false), D(true): B->A ve D->C; C'nin ön koşulu yok; denetim auto", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, true, false, true]);
    const r = await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    expect(r).toEqual({ created: 4 });
    const [A, B, C, D] = await Promise.all(steps.map(async (s) => (await ticketOfStep(s.id))[0]!));
    const e = await edges();
    expect(e.map((x) => `${x.ticketId}>${x.dependsOnId}`).sort()).toEqual(
      [`${B!.id}>${A!.id}`, `${D!.id}>${C!.id}`].sort(),
    );
    expect(e.some((x) => x.ticketId === C!.id)).toBe(false);
    const aud = await auditRows("ticket.dependency_add");
    expect(aud).toHaveLength(2);
    for (const a of aud) expect((a.data as { auto?: boolean }).auto).toBe(true);
  });

  it("ikinci çağrı yinelenen ticket ya da bağlantı üretmez", async () => {
    const { c, roadmap } = await roadmapWith([false, true, true]);
    await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    const r2 = await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    expect(r2).toEqual({ created: 0 });
    expect(await db.select().from(tickets)).toHaveLength(3);
    expect(await edges()).toHaveLength(2);
    expect(await auditRows("ticket.dependency_add")).toHaveLength(2);
  });

  it("önceki basamağın ticket'ı daha önce oluşmuşsa ona bağlanır", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, true]);
    const pre = await makeTicketRow({
      areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, roadmapStepId: steps[0]!.id,
    });
    const r = await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    expect(r.created).toBe(1);
    const B = (await ticketOfStep(steps[1]!.id))[0]!;
    expect((await edges()).map((x) => [x.ticketId, x.dependsOnId])).toEqual([[B.id, pre.id]]);
  });

  it("önceki basamağın ticket'ı iptalse bağlantı kurulmaz, daha geriye bakılmaz", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, true, true]);
    // A'nın ticket'ı var (iptal değil), B'ninki iptal edilmiş.
    await makeTicketRow({ areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, roadmapStepId: steps[0]!.id });
    await makeTicketRow({
      areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, roadmapStepId: steps[1]!.id, status: "cancelled",
    });
    const r = await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    // B iptalli ticket'a sahip ama aktif ticketı yok -> yeni B ticket'ı da açılabilir; C için asıl kural:
    expect(r.created).toBeGreaterThanOrEqual(1);
    const cTicket = (await ticketOfStep(steps[2]!.id))[0]!;
    const cEdges = (await edges()).filter((x) => x.ticketId === cTicket.id);
    const cancelled = (await ticketOfStep(steps[1]!.id)).find((t) => t.status === "cancelled")!;
    expect(cEdges.some((x) => x.dependsOnId === cancelled.id)).toBe(false);
    const A = (await ticketOfStep(steps[0]!.id))[0]!;
    expect(cEdges.some((x) => x.dependsOnId === A.id)).toBe(false);
  });

  it("önceki basamağın ticket'ı iptalse hiçbir bağlantı iptal ticket'ı göstermez", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, true]);
    const dead = await makeTicketRow({
      areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, roadmapStepId: steps[0]!.id, status: "cancelled",
    });
    await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    expect((await edges()).some((x) => x.dependsOnId === dead.id)).toBe(false);
  });
});

/** A->B sıralı iki ticket (alan A), yayınlanmış; üye ana alanı `home`. */
async function publishedPair() {
  const { c, roadmap, steps } = await roadmapWith([false, true]);
  await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
  const A = (await ticketOfStep(steps[0]!.id))[0]!;
  const B = (await ticketOfStep(steps[1]!.id))[0]!;
  await publishTickets(db, c.mgrA, { ticketIds: [A.id, B.id] });
  return { c, A, B };
}

describe("otomatik havuza çıkış (çekme modeli)", () => {
  it("A teslim edilmeden B takeable=false ve havuz B'yi hiç vermez", async () => {
    const { c, A, B } = await publishedPair();
    const view = await listAreaTickets(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id });
    expect(view.tickets.find((t) => t.id === B.id)!.takeable).toBe(false);
    expect(view.tickets.find((t) => t.id === A.id)!.takeable).toBe(true);
    for (let i = 0; i < 12; i++) {
      const m = await makeMember(c.home.id, `Üye ${i}`);
      const r = await requestTicket(db, m, T0);
      expect(r.kind).toBe("offered");
      if (r.kind === "offered") expect(r.offer.ticket.id).toBe(A.id);
      await resetToPool([A.id]);
    }
    expect((await ticketById(B.id)).status).toBe("available");
  });

  it("yalnız B kalırsa havuz boş döner", async () => {
    const { c, A } = await publishedPair();
    await db.update(tickets).set({ status: "taken", assigneeId: c.member.id }).where(eq(tickets.id, A.id));
    const m = await makeMember(c.home.id, "Başka");
    expect((await requestTicket(db, m, T0)).kind).toBe("empty");
  });

  it("A teslim edilince B alınabilir olur ve çekilebilir; atama yapılmaz", async () => {
    const { c, A, B } = await publishedPair();
    await db.update(tickets).set({ status: "taken", assigneeId: c.member.id, takenAt: T0, dueAt: at(72 * 3_600_000) }).where(eq(tickets.id, A.id));
    await submitTicket(db, c.member, { ticketId: A.id, description: "Bitti", links: [], fileIds: [] }, at(3_600_000));
    expect((await ticketById(A.id)).status).toBe("submitted");
    const bRow = (await listAreaTickets(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id })).tickets.find((t) => t.id === B.id)!;
    expect(bRow.takeable).toBe(true);
    expect((await ticketById(B.id)).assigneeId).toBeNull();
    const m = await makeMember(c.home.id, "Çeken");
    const r = await requestTicket(db, m, at(2 * 3_600_000));
    expect(r.kind).toBe("offered");
    if (r.kind === "offered") expect(r.offer.ticket.id).toBe(B.id);
  });

  it("A iptal edilince de B alınabilir olur", async () => {
    const { c, A, B } = await publishedPair();
    await cancelTicket(db, c.mgrA, { ticketId: A.id });
    const bRow = (await listAreaTickets(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id })).tickets.find((t) => t.id === B.id)!;
    expect(bRow.takeable).toBe(true);
    expect((await ticketById(B.id)).assigneeId).toBeNull();
    const m = await makeMember(c.home.id, "Çeken");
    const r = await requestTicket(db, m, T0);
    expect(r.kind).toBe("offered");
    if (r.kind === "offered") expect(r.offer.ticket.id).toBe(B.id);
  });

  it("paralel (bağlantısız) C hemen alınabilir", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, false]);
    await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    const ids = (await db.select().from(tickets)).map((t) => t.id);
    await publishTickets(db, c.mgrA, { ticketIds: ids });
    const view = await listAreaTickets(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id });
    expect(view.tickets.every((t) => t.takeable)).toBe(true);
    expect(steps).toHaveLength(2);
  });
});

describe("döngü engeli", () => {
  it("otomatik bağlantıya ters elle bağlantı CONFLICT", async () => {
    const { c, roadmap, steps } = await roadmapWith([false, true]);
    await createTicketsFromSteps(db, c.mgrA, { roadmapId: roadmap.id });
    const A = (await ticketOfStep(steps[0]!.id))[0]!;
    const B = (await ticketOfStep(steps[1]!.id))[0]!;
    await expectCode(addDependency(db, c.mgrA, { ticketId: A.id, dependsOnId: B.id }), "CONFLICT");
    expect(await edges()).toHaveLength(1);
  });

  it("alanlar arası üçlü döngü engellenir", async () => {
    const c = await setupCycle();
    const mk = (areaId: string) =>
      makeTicketRow({ areaId, sprintId: c.sprint.id, createdById: c.admin.id, status: "available" });
    const x = await mk(c.areaA.id);
    const y = await mk(c.areaB.id);
    const z = await mk(c.areaA.id);
    await addDependency(db, c.mgrA, { ticketId: x.id, dependsOnId: y.id }); // x -> y
    await addDependency(db, c.mgrB, { ticketId: y.id, dependsOnId: z.id }); // y -> z
    await expectCode(addDependency(db, c.mgrA, { ticketId: z.id, dependsOnId: x.id }), "CONFLICT"); // z -> x
    expect(await edges()).toHaveLength(2);
  });

  it("eşzamanlı iki ters addDependency: en fazla biri başarılı", async () => {
    const c = await setupCycle();
    const A = await makeTicketRow({ areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "available" });
    const B = await makeTicketRow({ areaId: c.areaB.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "available" });
    const res = await Promise.allSettled([
      addDependency(db, c.mgrA, { ticketId: A.id, dependsOnId: B.id }),
      addDependency(db, c.mgrB, { ticketId: B.id, dependsOnId: A.id }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(1);
    expect(await edges()).toHaveLength(1);
  });
});

describe("listAreaTickets: dependents", () => {
  it("bekleyenler, alanlar arası dahil", async () => {
    const c = await setupCycle();
    const mk = (areaId: string) =>
      makeTicketRow({ areaId, sprintId: c.sprint.id, createdById: c.admin.id, status: "available" });
    const pre = await mk(c.areaA.id);
    const w1 = await mk(c.areaA.id);
    const w2 = await mk(c.areaB.id);
    await addDependency(db, c.mgrA, { ticketId: w1.id, dependsOnId: pre.id });
    await addDependency(db, c.mgrB, { ticketId: w2.id, dependsOnId: pre.id });
    const view = await listAreaTickets(db, c.mgrA, { areaId: c.areaA.id, sprintId: c.sprint.id });
    const row = view.tickets.find((t) => t.id === pre.id)!;
    expect(row.dependents.map((d) => d.id).sort()).toEqual([w1.id, w2.id].sort());
    expect(row.dependents.find((d) => d.id === w2.id)!.areaId).toBe(c.areaB.id);
    expect(view.tickets.find((t) => t.id === w1.id)!.dependents).toEqual([]);
  });
});

describe("gerçek zaman: bağlantı olayları", () => {
  let listener: Client;
  const got: { kind: string; areaId: string }[] = [];
  const settle = () => new Promise((r) => setTimeout(r, 400));
  beforeEach(async () => {
    got.length = 0;
    listener = new Client({ connectionString: process.env.DATABASE_URL_TEST });
    await listener.connect();
    listener.on("notification", (n) => got.push(JSON.parse(n.payload!)));
    await listener.query("LISTEN sector7_events");
  });
  afterEach(async () => {
    await listener.end();
  });

  it("add/remove bekleyen ticket'ın alanı için tickets olayı yayınlar", async () => {
    const c = await setupCycle();
    const pre = await makeTicketRow({ areaId: c.areaB.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "available" });
    const waiting = await makeTicketRow({ areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "available" });
    await settle();
    got.length = 0;
    await addDependency(db, c.mgrA, { ticketId: waiting.id, dependsOnId: pre.id });
    await settle();
    expect(got).toContainEqual({ kind: "tickets", areaId: c.areaA.id });
    expect(got.every((e) => e.areaId === c.areaA.id)).toBe(true);
    got.length = 0;
    await removeDependency(db, c.mgrA, { ticketId: waiting.id, dependsOnId: pre.id });
    await settle();
    expect(got).toContainEqual({ kind: "tickets", areaId: c.areaA.id });
    expect(got.every((e) => e.areaId === c.areaA.id)).toBe(true);
  });
});
