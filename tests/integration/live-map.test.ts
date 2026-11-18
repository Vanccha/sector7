import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { areas, tickets, user } from "../../src/db/schema";
import { IN_PROGRESS_STATUSES } from "../../src/lib/contracts/tickets";
import { getLiveMap } from "../../src/server/live-map";
import { db, makeActiveSprint, makeArea, makeUser, resetDb } from "../helpers/db";
import { at, makeMember, poolTicket, setupCycle, takenTicket } from "../helpers/cycle";
import { makeTicketRow } from "../helpers/plan";
import { expectCode } from "../helpers/errors";

beforeEach(resetDb);

describe("getLiveMap erişim", () => {
  it("oturumsuz UNAUTHENTICATED, pasif aktör FORBIDDEN", async () => {
    const c = await setupCycle();
    await expectCode(() => getLiveMap(db, null as never), "UNAUTHENTICATED");
    await db.update(user).set({ active: false }).where(eq(user.id, c.member.id));
    await expectCode(() => getLiveMap(db, c.member), "FORBIDDEN");
  });

  it("üye, alan yöneticisi ve ana yönetici aynı sonucu görür", async () => {
    const c = await setupCycle();
    await takenTicket(c, c.areaA.id, c.member);
    const strip = (m: Awaited<ReturnType<typeof getLiveMap>>) => ({ ...m, generatedAt: "" });
    const [a, b, d] = await Promise.all([
      getLiveMap(db, c.member),
      getLiveMap(db, c.mgrA),
      getLiveMap(db, c.admin),
    ]);
    expect(strip(b)).toEqual(strip(a));
    expect(strip(d)).toEqual(strip(a));
    expect(a.links).toHaveLength(1);
    expect(Number.isNaN(Date.parse(a.generatedAt))).toBe(false);
  });
});

describe("getLiveMap bağlantılar", () => {
  it("yalnız IN_PROGRESS_STATUSES bağlantı olur", async () => {
    const c = await setupCycle();
    const ids: Record<string, string> = {};
    for (const s of IN_PROGRESS_STATUSES) {
      const m = await makeMember(c.home.id, `Kişi ${s}`);
      ids[s] = (await takenTicket(c, c.areaA.id, m, { status: s })).id;
    }
    for (const s of ["offered", "available", "submitted", "draft", "cancelled"] as const) {
      const m = await makeMember(c.home.id, `Dışı ${s}`);
      await makeTicketRow({
        areaId: c.areaA.id,
        sprintId: c.sprint.id,
        createdById: c.admin.id,
        status: s,
        assigneeId: s === "available" || s === "draft" ? null : m.id,
      });
    }
    const map = await getLiveMap(db, c.member);
    expect(map.links.map((l) => l.ticketId).sort()).toEqual(Object.values(ids).sort());
    expect(map.links.map((l) => l.status).sort()).toEqual([...IN_PROGRESS_STATUSES].sort());
    expect(map.people).toHaveLength(IN_PROGRESS_STATUSES.length);
  });

  it("sprint fark etmez: bitmiş sprintteki sürmekte olan ticket de görünür", async () => {
    const c = await setupCycle();
    const old = await makeActiveSprint({ number: 2, name: "S2", status: "closed" });
    const m = await makeMember(c.home.id);
    const t = await makeTicketRow({
      areaId: c.areaA.id, sprintId: old.id, createdById: c.admin.id, status: "taken", assigneeId: m.id, takenAt: at(0),
    });
    const map = await getLiveMap(db, c.member);
    expect(map.links.map((l) => l.ticketId)).toEqual([t.id]);
  });

  it("paused = pausedAt dolu; alanlar doğru eşlenir", async () => {
    const c = await setupCycle();
    const m1 = await makeMember(c.home.id, "Bir");
    const m2 = await makeMember(c.home.id, "İki");
    const t1 = await takenTicket(c, c.areaA.id, m1, { status: "extension_pending", pausedAt: at(1000) });
    const t2 = await takenTicket(c, c.areaA.id, m2);
    const map = await getLiveMap(db, c.member);
    const l1 = map.links.find((l) => l.ticketId === t1.id)!;
    const l2 = map.links.find((l) => l.ticketId === t2.id)!;
    expect(l1.paused).toBe(true);
    expect(l2.paused).toBe(false);
    expect(l2).toMatchObject({ title: t2.title, areaId: c.areaA.id, userId: m2.id, status: "taken", takenAt: at(0).toISOString() });
  });

  it("pasif kişinin ticket'ı haritada yok", async () => {
    const c = await setupCycle();
    const gone = await makeMember(c.home.id, "Pasif");
    await takenTicket(c, c.areaA.id, gone);
    await db.update(user).set({ active: false }).where(eq(user.id, gone.id));
    const map = await getLiveMap(db, c.member);
    expect(map.links).toEqual([]);
    expect(map.people).toEqual([]);
    expect(map.areas.find((a) => a.id === c.areaA.id)!.activeCount).toBe(0);
  });
});

describe("getLiveMap kişiler", () => {
  it("yalnız bağlantısı olanlar; yalnız id, name, homeAreaId anahtarları", async () => {
    const c = await setupCycle();
    const worker = await makeUser({ name: "Çalışan", homeAreaId: c.home.id, phone: "+905551112233", email: "gizli@example.com" } as never);
    await takenTicket(c, c.areaA.id, { id: worker.id } as never);
    await poolTicket(c, c.areaA.id);
    const map = await getLiveMap(db, c.admin);
    expect(map.people).toHaveLength(1);
    expect(Object.keys(map.people[0]!).sort()).toEqual(["homeAreaId", "id", "name"]);
    expect(map.people[0]).toEqual({ id: worker.id, name: "Çalışan", homeAreaId: c.home.id });
    const json = JSON.stringify(map);
    expect(json).not.toContain("gizli@example.com");
    expect(json).not.toContain("+905551112233");
  });

  it("homeAreaId yoksa null; kişiler ada göre sıralı; aynı kişi tek kez", async () => {
    const c = await setupCycle();
    const z = await makeMember(c.home.id, "Zeynep");
    const a = await makeMember(c.home.id, "Ahmet");
    const noHome = await makeUser({ name: "Mehmet", homeAreaId: null });
    await takenTicket(c, c.areaA.id, z);
    await takenTicket(c, c.areaB.id, z);
    await takenTicket(c, c.areaA.id, a);
    await takenTicket(c, c.areaA.id, { id: noHome.id } as never);
    const map = await getLiveMap(db, c.member);
    expect(map.people.map((p) => p.name)).toEqual(["Ahmet", "Mehmet", "Zeynep"]);
    expect(map.people.find((p) => p.name === "Mehmet")!.homeAreaId).toBeNull();
    expect(map.links).toHaveLength(4);
  });
});

describe("getLiveMap alanlar", () => {
  it("arşivsiz tüm alanlar; arşivli yalnız bağlantısı varsa; activeCount; ad sırası", async () => {
    const sc = await setupCycle();
    await db.update(areas).set({ name: "Zzz Alan" }).where(eq(areas.id, sc.areaA.id));
    await db.update(areas).set({ name: "Aaa Alan" }).where(eq(areas.id, sc.areaB.id));
    await db.update(areas).set({ name: "Mmm Alan" }).where(eq(areas.id, sc.home.id));
    const archivedLinked = await makeArea({ name: "Bbb Arşivli Bağlı", archivedAt: new Date() });
    const archivedEmpty = await makeArea({ name: "Ccc Arşivli Boş", archivedAt: new Date() });
    const m1 = await makeMember(sc.home.id, "K1");
    const m2 = await makeMember(sc.home.id, "K2");
    await takenTicket(sc, sc.areaA.id, m1);
    await takenTicket(sc, sc.areaA.id, m2);
    await takenTicket(sc, archivedLinked.id, m1);
    await poolTicket(sc, sc.areaB.id);
    const map = await getLiveMap(db, sc.member);
    expect(map.areas.map((a) => a.name)).toEqual(["Aaa Alan", "Bbb Arşivli Bağlı", "Mmm Alan", "Zzz Alan"]);
    expect(map.areas.find((a) => a.id === archivedEmpty.id)).toBeUndefined();
    const by = Object.fromEntries(map.areas.map((a) => [a.id, a]));
    expect(by[sc.areaA.id]).toMatchObject({ activeCount: 2, archived: false });
    expect(by[sc.areaB.id]!.activeCount).toBe(0);
    expect(by[archivedLinked.id]).toMatchObject({ activeCount: 1, archived: true });
  });
});

describe("tickets_notify_change tetikleyicisi", () => {
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

  async function fixture() {
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    await settle();
    got.length = 0; // kurulum olaylarını at
    return { c, t };
  }

  it("INSERT olay üretir: {kind:'tickets', areaId}", async () => {
    const c = await setupCycle();
    got.length = 0;
    await settle();
    got.length = 0;
    const t = await poolTicket(c, c.areaB.id);
    await settle();
    expect(got).toEqual([{ kind: "tickets", areaId: t.areaId }]);
  });

  it("status değişimi olay üretir", async () => {
    const { c, t } = await fixture();
    await db.update(tickets).set({ status: "offered" }).where(eq(tickets.id, t.id));
    await settle();
    expect(got).toEqual([{ kind: "tickets", areaId: c.areaA.id }]);
  });

  it("assignee değişimi olay üretir", async () => {
    const { c, t } = await fixture();
    await db.update(tickets).set({ assigneeId: c.member.id }).where(eq(tickets.id, t.id));
    await settle();
    expect(got).toEqual([{ kind: "tickets", areaId: c.areaA.id }]);
  });

  it("yalnız başlık değişimi olay üretmez", async () => {
    const { t } = await fixture();
    await db.update(tickets).set({ title: "Yeni başlık" }).where(eq(tickets.id, t.id));
    await settle();
    expect(got).toEqual([]);
  });

  it("aynı status'u yazmak olay üretmez", async () => {
    const { t } = await fixture();
    await db.update(tickets).set({ status: t.status }).where(eq(tickets.id, t.id));
    await settle();
    expect(got).toEqual([]);
  });

  it("geri alınan transaction olay üretmez", async () => {
    const { c, t } = await fixture();
    await expect(
      db.transaction(async (tx) => {
        await tx.update(tickets).set({ status: "offered", assigneeId: c.member.id }).where(eq(tickets.id, t.id));
        await poolTicket(c, c.areaA.id); // ayrı bağlantı, etkilenmez; aşağıda saymıyoruz
        throw new Error("geri al");
      }),
    ).rejects.toThrow("geri al");
    await settle();
    // yalnız tx dışındaki poolTicket INSERT'ü (1 olay) gelebilir; tx içindeki update olay üretmemeli
    expect(got.length).toBeLessThanOrEqual(1);
    const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row!.status).toBe("available");
  });

  it("yalnız geri alınan transaction: hiç olay yok", async () => {
    const { c, t } = await fixture();
    await expect(
      db.transaction(async (tx) => {
        await tx.update(tickets).set({ status: "offered", assigneeId: c.member.id }).where(eq(tickets.id, t.id));
        throw new Error("geri al");
      }),
    ).rejects.toThrow();
    await settle();
    expect(got).toEqual([]);
  });
});
