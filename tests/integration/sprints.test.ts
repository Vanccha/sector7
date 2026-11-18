import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sprints } from "../../src/db/schema";
import { createSprint, listSprints, startSprint, updateSprint } from "../../src/server/sprints";
import { db, makeActor, makeActiveSprint, makeMainAdmin, resetDb } from "../helpers/db";
import { expectCode } from "../helpers/errors";
import { auditRows, makeManagerActor } from "../helpers/plan";

async function planned(number: number) {
  const [s] = await db
    .insert(sprints)
    .values({ number, name: `Sprint ${number}`, startDate: "2026-12-01", lengthDays: 21, status: "planned" })
    .returning();
  return s!;
}

describe("sprint yetkisi", () => {
  beforeEach(resetDb);

  it("yalnız ana yönetici sprint yönetir", async () => {
    const s = await planned(1);
    const mgr = await makeManagerActor();
    const member = await makeActor();
    for (const a of [mgr.actor, member]) {
      await expectCode(createSprint(db, a, { startDate: "2026-12-01" }), "FORBIDDEN");
      await expectCode(startSprint(db, a, { sprintId: s.id }), "FORBIDDEN");
      await expectCode(
        updateSprint(db, a, { sprintId: s.id, startDate: "2026-12-02", lengthDays: 14, name: "x" }),
        "FORBIDDEN",
      );
      await expectCode(listSprints(db, a), "FORBIDDEN");
    }
    await expectCode(createSprint(db, null, { startDate: "2026-12-01" }), "UNAUTHENTICATED");
  });
});

describe("createSprint", () => {
  beforeEach(resetDb);

  it("numarayı artırır, ad ve süre varsayılanlarını uygular", async () => {
    const admin = await makeMainAdmin();
    const a = await createSprint(db, admin, { startDate: "2026-12-01" });
    const b = await createSprint(db, admin, { startDate: "2026-12-22", name: "Özel", lengthDays: 14 });
    const [ra] = await db.select().from(sprints).where(eq(sprints.id, a.id));
    const [rb] = await db.select().from(sprints).where(eq(sprints.id, b.id));
    expect(ra).toMatchObject({ number: 1, name: "Sprint 1", lengthDays: 21, status: "planned" });
    expect(rb).toMatchObject({ number: 2, name: "Özel", lengthDays: 14, status: "planned" });
    expect(await auditRows("sprint.create")).toHaveLength(2);
  });

  it("eşzamanlı iki createSprint farklı numara alır", async () => {
    const admin = await makeMainAdmin();
    const res = await Promise.all([
      createSprint(db, admin, { startDate: "2026-12-01" }),
      createSprint(db, admin, { startDate: "2026-12-01" }),
    ]);
    const rows = await db.select().from(sprints);
    expect(rows.map((r) => r.number).sort()).toEqual([1, 2]);
    expect(res[0].id).not.toBe(res[1].id);
  });
});

describe("startSprint", () => {
  beforeEach(resetDb);

  it("aktif sprint varken INVALID_STATE", async () => {
    const admin = await makeMainAdmin();
    await makeActiveSprint();
    const p = await planned(2);
    await expectCode(startSprint(db, admin, { sprintId: p.id }), "INVALID_STATE");
    const [r] = await db.select().from(sprints).where(eq(sprints.id, p.id));
    expect(r?.status).toBe("planned");
  });

  it("aktif sprint yoksa planned -> active; aktif olanı tekrar başlatmak INVALID_STATE", async () => {
    const admin = await makeMainAdmin();
    const p = await planned(1);
    await startSprint(db, admin, { sprintId: p.id });
    const [r] = await db.select().from(sprints).where(eq(sprints.id, p.id));
    expect(r?.status).toBe("active");
    expect(await auditRows("sprint.start", p.id)).toHaveLength(1);
    await expectCode(startSprint(db, admin, { sprintId: p.id }), "INVALID_STATE");
  });

  it("eşzamanlı iki planlı sprint başlatılırsa tam biri aktif olur", async () => {
    const admin = await makeMainAdmin();
    const a = await planned(1);
    const b = await planned(2);
    const res = await Promise.allSettled([
      startSprint(db, admin, { sprintId: a.id }),
      startSprint(db, admin, { sprintId: b.id }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rej = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rej.reason.code).toBe("INVALID_STATE");
    const active = (await db.select().from(sprints)).filter((s) => s.status === "active");
    expect(active).toHaveLength(1);
  });
});

describe("updateSprint", () => {
  beforeEach(resetDb);

  it("planlı sprint güncellenir; kapanmış sprint INVALID_STATE", async () => {
    const admin = await makeMainAdmin();
    const p = await planned(1);
    await updateSprint(db, admin, { sprintId: p.id, startDate: "2026-12-05", lengthDays: 14, name: "Yeni" });
    const [r] = await db.select().from(sprints).where(eq(sprints.id, p.id));
    expect(r).toMatchObject({ name: "Yeni", startDate: "2026-12-05", lengthDays: 14 });
    const closed = await makeActiveSprint({ number: 9, status: "closed" });
    await expectCode(
      updateSprint(db, admin, { sprintId: closed.id, startDate: "2026-12-05", lengthDays: 14, name: "Z" }),
      "INVALID_STATE",
    );
  });
});
