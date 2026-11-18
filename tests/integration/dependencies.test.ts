import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ticketDependencies, tickets } from "../../src/db/schema";
import { addDependency, removeDependency, searchPrereqCandidates } from "../../src/server/dependencies";
import { db, makeActiveSprint, makeArea, makeMainAdmin, resetDb } from "../helpers/db";
import { expectCode } from "../helpers/errors";
import { auditRows, makeManagerActor, makeTicketRow } from "../helpers/plan";

const edges = () => db.select().from(ticketDependencies);
const edgeCount = async (ticketId: string, dependsOnId: string) =>
  (
    await db
      .select()
      .from(ticketDependencies)
      .where(and(eq(ticketDependencies.ticketId, ticketId), eq(ticketDependencies.dependsOnId, dependsOnId)))
  ).length;

/** İki alan, her birinin yöneticisi, ortak aktif sprint. */
async function world() {
  const sprint = await makeActiveSprint();
  const a = await makeManagerActor();
  const b = await makeManagerActor();
  const mk = (who: typeof a, over: Partial<typeof tickets.$inferInsert> = {}) =>
    makeTicketRow({ areaId: who.area.id, sprintId: sprint.id, createdById: who.user.id, status: "available", ...over });
  return { sprint, a, b, mk };
}

describe("addDependency: yetki", () => {
  beforeEach(resetDb);

  it("bağımlı ticket'ın alan yöneticisi kurabilir (ön koşul başka alandan), ana yönetici de", async () => {
    const { a, b, mk } = await world();
    const admin = await makeMainAdmin();
    const waiting = await mk(a);
    const pre = await mk(b);
    await addDependency(db, a.actor, { ticketId: waiting.id, dependsOnId: pre.id });
    expect(await edgeCount(waiting.id, pre.id)).toBe(1);
    const w2 = await mk(a);
    await addDependency(db, admin, { ticketId: w2.id, dependsOnId: pre.id });
    expect(await edgeCount(w2.id, pre.id)).toBe(1);
  });

  it("ön koşulun alan yöneticisi (bağımlının değil) FORBIDDEN; oturumsuz UNAUTHENTICATED", async () => {
    const { a, b, mk } = await world();
    const waiting = await mk(a);
    const pre = await mk(b);
    await expectCode(addDependency(db, b.actor, { ticketId: waiting.id, dependsOnId: pre.id }), "FORBIDDEN");
    await expectCode(addDependency(db, null, { ticketId: waiting.id, dependsOnId: pre.id }), "UNAUTHENTICATED");
    expect(await edges()).toHaveLength(0);
  });
});

describe("addDependency: kurallar", () => {
  beforeEach(resetDb);

  it("kendine bağ reddedilir", async () => {
    const { a, mk } = await world();
    const t = await mk(a);
    await expect(addDependency(db, a.actor, { ticketId: t.id, dependsOnId: t.id })).rejects.toThrow();
    expect(await edges()).toHaveLength(0);
  });

  it("iptal edilmiş ön koşul INVALID_STATE", async () => {
    const { a, mk } = await world();
    const t = await mk(a);
    const c = await mk(a, { status: "cancelled" });
    await expectCode(addDependency(db, a.actor, { ticketId: t.id, dependsOnId: c.id }), "INVALID_STATE");
  });

  it("aynı bağ iki kez eklenirse tek satır kalır", async () => {
    const { a, mk } = await world();
    const t = await mk(a);
    const p = await mk(a);
    await addDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id });
    await addDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id });
    expect(await edges()).toHaveLength(1);
    expect(await auditRows("ticket.dependency_add", t.id)).toHaveLength(1);
  });

  it("taken bağımlı ticket'ın bağları değiştirilemez", async () => {
    const { a, mk } = await world();
    const t = await mk(a, { status: "taken" });
    const p = await mk(a);
    await expectCode(addDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id }), "INVALID_STATE");
    await db.insert(ticketDependencies).values({ ticketId: t.id, dependsOnId: p.id });
    await expectCode(removeDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id }), "INVALID_STATE");
    expect(await edgeCount(t.id, p.id)).toBe(1);
  });

  it("kapanmış sprintteki ticket'ın bağları değiştirilemez", async () => {
    const closed = await makeActiveSprint({ status: "closed" });
    const a = await makeManagerActor();
    const mk = () =>
      makeTicketRow({ areaId: a.area.id, sprintId: closed.id, createdById: a.user.id, status: "available" });
    const t = await mk();
    const p = await mk();
    await expectCode(addDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id }), "INVALID_STATE");
    await db.insert(ticketDependencies).values({ ticketId: t.id, dependsOnId: p.id });
    await expectCode(removeDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id }), "INVALID_STATE");
    expect(await edgeCount(t.id, p.id)).toBe(1);
  });

  it("olmayan ticket NOT_FOUND", async () => {
    const { a, mk } = await world();
    const t = await mk(a);
    await expectCode(
      addDependency(db, a.actor, { ticketId: t.id, dependsOnId: "00000000-0000-4000-8000-000000000000" }),
      "NOT_FOUND",
    );
  });
});

describe("addDependency: döngü", () => {
  beforeEach(resetDb);

  it("A->B varken B->A CONFLICT ve satır eklenmez", async () => {
    const { a, mk } = await world();
    const A = await mk(a);
    const B = await mk(a);
    await addDependency(db, a.actor, { ticketId: A.id, dependsOnId: B.id });
    await expectCode(addDependency(db, a.actor, { ticketId: B.id, dependsOnId: A.id }), "CONFLICT");
    expect(await edges()).toHaveLength(1);
    expect(await edgeCount(B.id, A.id)).toBe(0);
  });

  it("alanlar arası A->B, B->C varken C->A CONFLICT", async () => {
    const { a, b, mk } = await world();
    const admin = await makeMainAdmin();
    const A = await mk(a);
    const B = await mk(b);
    const C = await mk(a);
    await addDependency(db, admin, { ticketId: A.id, dependsOnId: B.id });
    await addDependency(db, admin, { ticketId: B.id, dependsOnId: C.id });
    await expectCode(addDependency(db, a.actor, { ticketId: C.id, dependsOnId: A.id }), "CONFLICT");
    await expectCode(addDependency(db, admin, { ticketId: C.id, dependsOnId: A.id }), "CONFLICT");
    expect(await edges()).toHaveLength(2);
    expect(await edgeCount(C.id, A.id)).toBe(0);
  });

  it("döngü olmayan elmas (diamond) grafiğe izin verilir", async () => {
    const { a, mk } = await world();
    const [A, B, C, D] = [await mk(a), await mk(a), await mk(a), await mk(a)] as const;
    await addDependency(db, a.actor, { ticketId: A.id, dependsOnId: B.id });
    await addDependency(db, a.actor, { ticketId: A.id, dependsOnId: C.id });
    await addDependency(db, a.actor, { ticketId: B.id, dependsOnId: D.id });
    await addDependency(db, a.actor, { ticketId: C.id, dependsOnId: D.id });
    expect(await edges()).toHaveLength(4);
  });

  it("eşzamanlı A->B ve B->A: tam biri başarılı, grafik döngüsüz", async () => {
    const { a, mk } = await world();
    const A = await mk(a);
    const B = await mk(a);
    const res = await Promise.allSettled([
      addDependency(db, a.actor, { ticketId: A.id, dependsOnId: B.id }),
      addDependency(db, a.actor, { ticketId: B.id, dependsOnId: A.id }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rej = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rej.reason.code).toBe("CONFLICT");
    expect(await edges()).toHaveLength(1);
  });
});

describe("removeDependency", () => {
  beforeEach(resetDb);

  it("bağı kaldırır ve denetim kaydı düşer; olmayan bağ sessizce geçilir", async () => {
    const { a, b, mk } = await world();
    const t = await mk(a);
    const p = await mk(b);
    await addDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id });
    await expectCode(removeDependency(db, b.actor, { ticketId: t.id, dependsOnId: p.id }), "FORBIDDEN");
    await removeDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id });
    expect(await edges()).toHaveLength(0);
    expect(await auditRows("ticket.dependency_remove", t.id)).toHaveLength(1);
    await removeDependency(db, a.actor, { ticketId: t.id, dependsOnId: p.id });
    expect(await auditRows("ticket.dependency_remove", t.id)).toHaveLength(1);
  });
});

describe("searchPrereqCandidates", () => {
  beforeEach(resetDb);

  it("kendisi, iptaller ve mevcut ön koşullar hariç; tüm alanlardan aday gelir", async () => {
    const { a, b, mk } = await world();
    const self = await mk(a, { title: "Kendisi" });
    const existing = await mk(a, { title: "Mevcut" });
    const cancelled = await mk(a, { title: "İptal" });
    const cancelledStatus = await db.update(tickets).set({ status: "cancelled" }).where(eq(tickets.id, cancelled.id));
    void cancelledStatus;
    const mine = await mk(a, { title: "Aday A" });
    const foreign = await mk(b, { title: "Aday B" });
    await addDependency(db, a.actor, { ticketId: self.id, dependsOnId: existing.id });
    const res = await searchPrereqCandidates(db, a.actor, { ticketId: self.id });
    const ids = res.map((r) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(foreign.id);
    expect(ids).not.toContain(self.id);
    expect(ids).not.toContain(existing.id);
    expect(ids).not.toContain(cancelled.id);
  });

  it("başlıkta arama yapar; yetkisiz kişi FORBIDDEN", async () => {
    const { a, b, mk } = await world();
    const self = await mk(a, { title: "Kendisi" });
    const hit = await mk(b, { title: "Veritabanı şeması" });
    await mk(b, { title: "Arayüz" });
    const res = await searchPrereqCandidates(db, a.actor, { ticketId: self.id, query: "veritaba" });
    expect(res.map((r) => r.id)).toEqual([hit.id]);
    await expectCode(searchPrereqCandidates(db, b.actor, { ticketId: self.id }), "FORBIDDEN");
  });

  it("% ve _ içeren sorgu hata vermez ve joker olarak çalışmaz", async () => {
    const { a, mk } = await world();
    const self = await mk(a, { title: "Kendisi" });
    const pct = await mk(a, { title: "Yüzde %50 hazır" });
    const und = await mk(a, { title: "snake_case adı" });
    await mk(a, { title: "Normal başlık" });
    await mk(a, { title: "snakeXcase adı" });
    expect((await searchPrereqCandidates(db, a.actor, { ticketId: self.id, query: "%" })).map((r) => r.id)).toEqual([
      pct.id,
    ]);
    expect((await searchPrereqCandidates(db, a.actor, { ticketId: self.id, query: "_" })).map((r) => r.id)).toEqual([
      und.id,
    ]);
    expect((await searchPrereqCandidates(db, a.actor, { ticketId: self.id, query: "e_c" })).map((r) => r.id)).toEqual([
      und.id,
    ]);
    await expect(searchPrereqCandidates(db, a.actor, { ticketId: self.id, query: "\\" })).resolves.toBeDefined();
  });

  it("en fazla 20 sonuç döner", async () => {
    const { a, mk } = await world();
    const self = await mk(a);
    for (let i = 0; i < 25; i++) await mk(a, { title: `Aday ${String(i).padStart(2, "0")}` });
    expect(await searchPrereqCandidates(db, a.actor, { ticketId: self.id })).toHaveLength(20);
  });
});

void makeArea;
