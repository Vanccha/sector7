import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { goals, roadmapSteps } from "../../src/db/schema";
import {
  addStep,
  approveRoadmap,
  createGoal,
  deleteGoal,
  deleteStep,
  getAreaPlan,
  reorderSteps,
  returnRoadmap,
  submitRoadmap,
  updateGoal,
  updateStep,
} from "../../src/server/plan";
import { db, makeActor, makeActiveSprint, makeArea, makeMainAdmin, resetDb } from "../helpers/db";
import { expectCode } from "../helpers/errors";
import { auditRows, getRoadmap, makeManagerActor, makeTicketRow, setupApprovedRoadmap } from "../helpers/plan";

async function stepsOf(roadmapId: string) {
  const rows = await db.select().from(roadmapSteps).where(eq(roadmapSteps.roadmapId, roadmapId));
  return rows.sort((a, b) => a.position - b.position);
}

describe("plan yetkisi", () => {
  beforeEach(resetDb);

  it("başka alanın yöneticisi ve üye hedef/basamak ekleyemez; sahibi ve ana yönetici ekleyebilir", async () => {
    const sprint = await makeActiveSprint();
    const owner = await makeManagerActor();
    const other = await makeManagerActor();
    const member = await makeActor();
    const admin = await makeMainAdmin();
    const g = { areaId: owner.area.id, sprintId: sprint.id, title: "Hedef" };
    const s = { areaId: owner.area.id, sprintId: sprint.id, title: "Basamak" };
    for (const a of [other.actor, member]) {
      await expectCode(createGoal(db, a, g), "FORBIDDEN");
      await expectCode(addStep(db, a, s), "FORBIDDEN");
    }
    await expectCode(createGoal(db, null, g), "UNAUTHENTICATED");
    await expect(createGoal(db, owner.actor, g)).resolves.toHaveProperty("id");
    await expect(addStep(db, owner.actor, s)).resolves.toHaveProperty("id");
    await expect(createGoal(db, admin, g)).resolves.toHaveProperty("id");
    await expect(addStep(db, admin, s)).resolves.toHaveProperty("id");
  });

  it("arşivli alan ve kapanmış sprint INVALID_STATE", async () => {
    const admin = await makeMainAdmin();
    const sprint = await makeActiveSprint();
    const closed = await makeActiveSprint({ number: 2, status: "closed" });
    const archived = await makeArea({ archivedAt: new Date() });
    const area = await makeArea();
    await expectCode(createGoal(db, admin, { areaId: archived.id, sprintId: sprint.id, title: "Hedef" }), "INVALID_STATE");
    await expectCode(addStep(db, admin, { areaId: archived.id, sprintId: sprint.id, title: "Adım" }), "INVALID_STATE");
    await expectCode(createGoal(db, admin, { areaId: area.id, sprintId: closed.id, title: "Hedef" }), "INVALID_STATE");
    await expectCode(addStep(db, admin, { areaId: area.id, sprintId: closed.id, title: "Adım" }), "INVALID_STATE");
  });
});

describe("hedefler", () => {
  beforeEach(resetDb);

  it("oluşturma, düzenleme, silme; silinen hedefin basamağı goalId=null olur", async () => {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const { id: goalId } = await createGoal(db, m.actor, {
      areaId: m.area.id,
      sprintId: sprint.id,
      title: "Hedef 1",
      requirements: "ger",
    });
    await updateGoal(db, m.actor, { goalId, title: "Hedef 1b", requirements: "yeni" });
    const [g] = await db.select().from(goals).where(eq(goals.id, goalId));
    expect(g).toMatchObject({ title: "Hedef 1b", requirements: "yeni" });
    const { id: stepId } = await addStep(db, m.actor, {
      areaId: m.area.id,
      sprintId: sprint.id,
      title: "Basamak",
      goalId,
    });
    await deleteGoal(db, m.actor, { goalId });
    expect(await db.select().from(goals).where(eq(goals.id, goalId))).toHaveLength(0);
    const [s] = await db.select().from(roadmapSteps).where(eq(roadmapSteps.id, stepId));
    expect(s?.goalId).toBeNull();
    expect(await auditRows("goal.create", goalId)).toHaveLength(1);
    expect(await auditRows("goal.delete", goalId)).toHaveLength(1);
  });

  it("başka alanın hedefi basamağa bağlanamaz", async () => {
    const sprint = await makeActiveSprint();
    const a = await makeManagerActor();
    const b = await makeManagerActor();
    const { id: foreignGoal } = await createGoal(db, b.actor, { areaId: b.area.id, sprintId: sprint.id, title: "B hedefi" });
    await expectCode(
      addStep(db, a.actor, { areaId: a.area.id, sprintId: sprint.id, title: "Adım", goalId: foreignGoal }),
      "INVALID_STATE",
    );
    const { id: stepId } = await addStep(db, a.actor, { areaId: a.area.id, sprintId: sprint.id, title: "Adım" });
    await expectCode(updateStep(db, a.actor, { stepId, title: "Adım", goalId: foreignGoal }), "INVALID_STATE");
  });

  it("başka alanın yöneticisi hedefi düzenleyemez/silemez", async () => {
    const sprint = await makeActiveSprint();
    const a = await makeManagerActor();
    const b = await makeManagerActor();
    const { id: goalId } = await createGoal(db, a.actor, { areaId: a.area.id, sprintId: sprint.id, title: "Hedef" });
    await expectCode(updateGoal(db, b.actor, { goalId, title: "Ele geçir" }), "FORBIDDEN");
    await expectCode(deleteGoal(db, b.actor, { goalId }), "FORBIDDEN");
  });
});

describe("roadmap onay akışı", () => {
  beforeEach(resetDb);

  it("roadmap ilk basamakla oluşur; basamaksızken submit INVALID_STATE", async () => {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const ref = { areaId: m.area.id, sprintId: sprint.id };
    let plan = await getAreaPlan(db, m.actor, ref);
    expect(plan.roadmap.id).toBeNull();
    expect(plan.roadmap.status).toBe("draft");
    await expectCode(submitRoadmap(db, m.actor, ref), "INVALID_STATE");
    await addStep(db, m.actor, { ...ref, title: "İlk basamak" });
    plan = await getAreaPlan(db, m.actor, ref);
    expect(plan.roadmap.id).not.toBeNull();
    expect(plan.roadmap.steps).toHaveLength(1);
  });

  it("draft -> submitted -> approved; yalnız ana yönetici onaylar/geri gönderir", async () => {
    const sprint = await makeActiveSprint();
    const admin = await makeMainAdmin();
    const m = await makeManagerActor();
    const ref = { areaId: m.area.id, sprintId: sprint.id };
    await addStep(db, m.actor, { ...ref, title: "Basamak" });
    await submitRoadmap(db, m.actor, ref);
    const roadmapId = (await getAreaPlan(db, m.actor, ref)).roadmap.id!;
    expect((await getRoadmap(roadmapId)).status).toBe("submitted");
    expect(await auditRows("roadmap.submit", roadmapId)).toHaveLength(1);
    // submitted iken tekrar gönderilemez
    await expectCode(submitRoadmap(db, m.actor, ref), "INVALID_STATE");
    await expectCode(approveRoadmap(db, m.actor, { roadmapId }), "FORBIDDEN");
    await expectCode(returnRoadmap(db, m.actor, { roadmapId, note: "neden" }), "FORBIDDEN");
    await expectCode(approveRoadmap(db, null, { roadmapId }), "UNAUTHENTICATED");
    await approveRoadmap(db, admin, { roadmapId });
    expect((await getRoadmap(roadmapId)).status).toBe("approved");
    expect(await auditRows("roadmap.approve", roadmapId)).toHaveLength(1);
    // onaylı olanı tekrar onaylamak/geri göndermek geçersiz
    await expectCode(approveRoadmap(db, admin, { roadmapId }), "INVALID_STATE");
    await expectCode(returnRoadmap(db, admin, { roadmapId, note: "neden" }), "INVALID_STATE");
  });

  it("draft roadmap onaylanamaz (submitted değil)", async () => {
    const sprint = await makeActiveSprint();
    const admin = await makeMainAdmin();
    const m = await makeManagerActor();
    const { roadmap } = await setupApprovedRoadmap({ areaId: m.area.id, sprintId: sprint.id, status: "draft" });
    await expectCode(approveRoadmap(db, admin, { roadmapId: roadmap.id }), "INVALID_STATE");
  });

  it("returnRoadmap notu saklar ve roadmap tekrar gönderilebilir", async () => {
    const sprint = await makeActiveSprint();
    const admin = await makeMainAdmin();
    const m = await makeManagerActor();
    const ref = { areaId: m.area.id, sprintId: sprint.id };
    await addStep(db, m.actor, { ...ref, title: "Basamak" });
    await submitRoadmap(db, m.actor, ref);
    const roadmapId = (await getAreaPlan(db, m.actor, ref)).roadmap.id!;
    await returnRoadmap(db, admin, { roadmapId, note: "Daha ayrıntılı yaz" });
    const rm = await getRoadmap(roadmapId);
    expect(rm.status).toBe("returned");
    expect(rm.reviewNote).toBe("Daha ayrıntılı yaz");
    expect((await getAreaPlan(db, m.actor, ref)).roadmap.reviewNote).toBe("Daha ayrıntılı yaz");
    expect(await auditRows("roadmap.return", roadmapId)).toHaveLength(1);
    await submitRoadmap(db, m.actor, ref);
    expect((await getRoadmap(roadmapId)).status).toBe("submitted");
  });
});

describe("yeniden onay kuralı", () => {
  beforeEach(resetDb);

  async function approved() {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const { roadmap, steps } = await setupApprovedRoadmap({
      areaId: m.area.id,
      sprintId: sprint.id,
      stepTitles: ["A", "B", "C"],
    });
    return { sprint, m, roadmap, steps };
  }

  it("basamak ekleme onaylı roadmap'i submitted yapar ve roadmap.resubmit kaydı düşer", async () => {
    const { sprint, m, roadmap } = await approved();
    await addStep(db, m.actor, { areaId: m.area.id, sprintId: sprint.id, title: "Yeni" });
    expect((await getRoadmap(roadmap.id)).status).toBe("submitted");
    expect(await auditRows("roadmap.resubmit", roadmap.id)).toHaveLength(1);
  });

  it("basamak düzenleme yeniden onaya düşürür", async () => {
    const { m, roadmap, steps } = await approved();
    await updateStep(db, m.actor, { stepId: steps[0]!.id, title: "A değişti" });
    expect((await getRoadmap(roadmap.id)).status).toBe("submitted");
    expect(await auditRows("roadmap.resubmit", roadmap.id)).toHaveLength(1);
  });

  it("basamak silme yeniden onaya düşürür", async () => {
    const { m, roadmap, steps } = await approved();
    await deleteStep(db, m.actor, { stepId: steps[2]!.id });
    expect((await getRoadmap(roadmap.id)).status).toBe("submitted");
    expect(await auditRows("roadmap.resubmit", roadmap.id)).toHaveLength(1);
  });

  it("sıralama yeniden onaya düşürür", async () => {
    const { m, roadmap, steps } = await approved();
    await reorderSteps(db, m.actor, { roadmapId: roadmap.id, stepIds: [steps[2]!.id, steps[0]!.id, steps[1]!.id] });
    expect((await getRoadmap(roadmap.id)).status).toBe("submitted");
    expect(await auditRows("roadmap.resubmit", roadmap.id)).toHaveLength(1);
  });

  it("onaylı olmayan roadmap'te değişiklik status'u değiştirmez ve resubmit kaydı düşmez", async () => {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const { roadmap, steps } = await setupApprovedRoadmap({ areaId: m.area.id, sprintId: sprint.id, status: "draft" });
    await updateStep(db, m.actor, { stepId: steps[0]!.id, title: "Değişti" });
    expect((await getRoadmap(roadmap.id)).status).toBe("draft");
    expect(await auditRows("roadmap.resubmit")).toHaveLength(0);
  });

  it("HEDEF düzenlemesi roadmap status'unu değiştirmez", async () => {
    const { sprint, m, roadmap } = await approved();
    const { id: goalId } = await createGoal(db, m.actor, { areaId: m.area.id, sprintId: sprint.id, title: "Hedef" });
    await updateGoal(db, m.actor, { goalId, title: "Hedef v2" });
    await deleteGoal(db, m.actor, { goalId });
    expect((await getRoadmap(roadmap.id)).status).toBe("approved");
    expect(await auditRows("roadmap.resubmit")).toHaveLength(0);
  });
});

describe("basamak silme ve sıralama", () => {
  beforeEach(resetDb);

  it("basamaktan ticket oluşturulmuşsa deleteStep INVALID_STATE", async () => {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const { steps } = await setupApprovedRoadmap({ areaId: m.area.id, sprintId: sprint.id });
    await makeTicketRow({
      areaId: m.area.id,
      sprintId: sprint.id,
      createdById: m.user.id,
      roadmapStepId: steps[0]!.id,
    });
    await expectCode(deleteStep(db, m.actor, { stepId: steps[0]!.id }), "INVALID_STATE");
    await deleteStep(db, m.actor, { stepId: steps[1]!.id });
    expect(await db.select().from(roadmapSteps).where(eq(roadmapSteps.id, steps[1]!.id))).toHaveLength(0);
  });

  it("reorderSteps eksik/fazla/tekrarlı id ile reddedilir; doğru kümeyle sıra güncellenir", async () => {
    const sprint = await makeActiveSprint();
    const m = await makeManagerActor();
    const { roadmap, steps } = await setupApprovedRoadmap({
      areaId: m.area.id,
      sprintId: sprint.id,
      stepTitles: ["A", "B", "C"],
      status: "draft",
    });
    const [a, b, c] = steps.map((s) => s.id) as [string, string, string];
    const other = await setupApprovedRoadmap({ areaId: (await makeArea()).id, sprintId: sprint.id });
    await expectCode(reorderSteps(db, m.actor, { roadmapId: roadmap.id, stepIds: [a, b] }), "INVALID_STATE");
    await expectCode(
      reorderSteps(db, m.actor, { roadmapId: roadmap.id, stepIds: [a, b, c, other.steps[0]!.id] }),
      "INVALID_STATE",
    );
    await expectCode(
      reorderSteps(db, m.actor, { roadmapId: roadmap.id, stepIds: [a, a, b] }),
      "INVALID_STATE",
    );
    await expectCode(
      reorderSteps(db, m.actor, { roadmapId: roadmap.id, stepIds: [a, b, other.steps[0]!.id] }),
      "INVALID_STATE",
    );
    expect((await stepsOf(roadmap.id)).map((s) => s.id)).toEqual([a, b, c]);
    await reorderSteps(db, m.actor, { roadmapId: roadmap.id, stepIds: [c, a, b] });
    const after = await stepsOf(roadmap.id);
    expect(after.map((s) => s.id)).toEqual([c, a, b]);
    expect(after.map((s) => s.position)).toEqual([1, 2, 3]);
  });
});

describe("getAreaPlan.canEdit", () => {
  beforeEach(resetDb);

  it("yönetici ve ana yönetici true; kapanmış sprintte false; başka alan yöneticisi FORBIDDEN", async () => {
    const sprint = await makeActiveSprint();
    const closed = await makeActiveSprint({ number: 2, status: "closed" });
    const admin = await makeMainAdmin();
    const m = await makeManagerActor();
    const other = await makeManagerActor();
    expect((await getAreaPlan(db, m.actor, { areaId: m.area.id, sprintId: sprint.id })).canEdit).toBe(true);
    expect((await getAreaPlan(db, admin, { areaId: m.area.id, sprintId: sprint.id })).canEdit).toBe(true);
    expect((await getAreaPlan(db, m.actor, { areaId: m.area.id, sprintId: closed.id })).canEdit).toBe(false);
    expect((await getAreaPlan(db, admin, { areaId: m.area.id, sprintId: closed.id })).canEdit).toBe(false);
    await expectCode(getAreaPlan(db, other.actor, { areaId: m.area.id, sprintId: sprint.id }), "FORBIDDEN");
    await expectCode(getAreaPlan(db, null, { areaId: m.area.id, sprintId: sprint.id }), "UNAUTHENTICATED");
  });
});
