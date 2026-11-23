import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { areas, auditLog, channelReads, channels, goals, roadmaps } from "../../src/db/schema";
import { loadActor } from "../../src/lib/auth/guards";
import {
  archiveArea,
  createArea,
  deleteArea,
  listAreas,
  listUserOptions,
  setAreaManager,
  unarchiveArea,
  updateArea,
} from "../../src/server/areas";
import { db, makeActor, makeActiveSprint, makeArea, makeMainAdmin, makeUser, resetDb } from "../helpers/db";
import { expectCode } from "../helpers/errors";
import { addMessages } from "../helpers/messaging";
import { auditRows, getTicket, makeManagerActor, makeTicketRow } from "../helpers/plan";

describe("alan yönetimi: yetki", () => {
  beforeEach(resetDb);

  it("alan yöneticisi, üye ve oturumsuz hiçbir işlemi yapamaz; ana yönetici yapabilir", async () => {
    const area = await makeArea();
    const mgr = await makeManagerActor();
    const member = await makeActor();
    const admin = await makeMainAdmin();
    const ops = (a: typeof admin | null) => [
      () => createArea(db, a, { name: "Yeni" }),
      () => updateArea(db, a, { areaId: area.id, name: "Ad" }),
      () => setAreaManager(db, a, { areaId: area.id, managerId: null }),
      () => archiveArea(db, a, { areaId: area.id }),
      () => unarchiveArea(db, a, { areaId: area.id }),
      () => listAreas(db, a),
      () => listUserOptions(db, a),
    ];
    for (const op of ops(mgr.actor)) await expectCode(op(), "FORBIDDEN");
    for (const op of ops(member)) await expectCode(op(), "FORBIDDEN");
    for (const op of ops(null)) await expectCode(op(), "UNAUTHENTICATED");
    await expect(listAreas(db, admin)).resolves.toBeDefined();
    await expect(createArea(db, admin, { name: "Yeni alan" })).resolves.toHaveProperty("id");
  });
});

describe("alan oluşturma ve güncelleme", () => {
  beforeEach(resetDb);

  it("createArea alanla birlikte area kanalı açar ve denetim kaydı düşer", async () => {
    const admin = await makeMainAdmin();
    const { id } = await createArea(db, admin, { name: "Tasarım", description: "d" });
    const ch = await db.select().from(channels).where(eq(channels.areaId, id));
    expect(ch).toHaveLength(1);
    expect(ch[0]?.kind).toBe("area");
    expect(ch[0]?.name).toBe("Tasarım");
    expect(await auditRows("area.create", id)).toHaveLength(1);
  });

  it("updateArea kanal adını da günceller ve denetim kaydı düşer", async () => {
    const admin = await makeMainAdmin();
    const { id } = await createArea(db, admin, { name: "Eski ad" });
    await updateArea(db, admin, { areaId: id, name: "Yeni ad", description: "x" });
    const [a] = await db.select().from(areas).where(eq(areas.id, id));
    expect(a?.name).toBe("Yeni ad");
    const [ch] = await db.select().from(channels).where(eq(channels.areaId, id));
    expect(ch?.name).toBe("Yeni ad");
    expect(await auditRows("area.update", id)).toHaveLength(1);
  });
});

describe("alan yöneticisi atama", () => {
  beforeEach(resetDb);

  it("atanan kişi alan yöneticisi rolü kazanır; null ile kaldırılır", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const u = await makeUser();
    expect((await loadActor(db, u.id))!.managedAreaIds).toEqual([]);
    await setAreaManager(db, admin, { areaId: area.id, managerId: u.id });
    expect((await loadActor(db, u.id))!.managedAreaIds).toEqual([area.id]);
    expect(await auditRows("area.set_manager", area.id)).toHaveLength(1);
    await setAreaManager(db, admin, { areaId: area.id, managerId: null });
    expect((await loadActor(db, u.id))!.managedAreaIds).toEqual([]);
  });

  it("pasif ve olmayan kullanıcı atanamaz", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const u = await makeUser({ active: false });
    await expectCode(setAreaManager(db, admin, { areaId: area.id, managerId: u.id }), "INVALID_STATE");
    await expectCode(
      setAreaManager(db, admin, { areaId: area.id, managerId: "00000000-0000-4000-8000-000000000000" }),
      "INVALID_STATE",
    );
  });

  it("arşivli alana yönetici atanamaz", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea({ archivedAt: new Date() });
    const u = await makeUser();
    await expectCode(setAreaManager(db, admin, { areaId: area.id, managerId: u.id }), "INVALID_STATE");
  });
});

describe("alan arşivleme", () => {
  beforeEach(resetDb);

  it("aktif ticket yokken arşivler; tekrar arşiv INVALID_STATE; unarchive geri alır", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    await expect(archiveArea(db, admin, { areaId: area.id })).resolves.toEqual({ archived: true });
    const [a] = await db.select().from(areas).where(eq(areas.id, area.id));
    expect(a?.archivedAt).not.toBeNull();
    expect(await auditRows("area.archive", area.id)).toHaveLength(1);
    await expectCode(archiveArea(db, admin, { areaId: area.id }), "INVALID_STATE");
    await unarchiveArea(db, admin, { areaId: area.id });
    const [b] = await db.select().from(areas).where(eq(areas.id, area.id));
    expect(b?.archivedAt).toBeNull();
    await expectCode(unarchiveArea(db, admin, { areaId: area.id }), "INVALID_STATE");
  });

  it("aktif ticket varken confirm:false uyarır ve alan değişmez", async () => {
    const admin = await makeMainAdmin();
    const sprint = await makeActiveSprint();
    const area = await makeArea();
    await makeTicketRow({ areaId: area.id, sprintId: sprint.id, createdById: admin.id, status: "available" });
    await makeTicketRow({ areaId: area.id, sprintId: sprint.id, createdById: admin.id, status: "draft" });
    const res = await archiveArea(db, admin, { areaId: area.id });
    expect(res).toEqual({ archived: false, activeTicketCount: 1 });
    const [a] = await db.select().from(areas).where(eq(areas.id, area.id));
    expect(a?.archivedAt).toBeNull();
    expect(await auditRows("area.archive")).toHaveLength(0);
  });

  it("confirm:true arşivler, ticket'lar değişmez, yönetici rolü düşer", async () => {
    const admin = await makeMainAdmin();
    const sprint = await makeActiveSprint();
    const mgr = await makeManagerActor();
    const t = await makeTicketRow({
      areaId: mgr.area.id,
      sprintId: sprint.id,
      createdById: admin.id,
      status: "available",
    });
    expect((await loadActor(db, mgr.user.id))!.managedAreaIds).toEqual([mgr.area.id]);
    await expect(archiveArea(db, admin, { areaId: mgr.area.id, confirm: true })).resolves.toEqual({ archived: true });
    const [after] = await db.select().from(areas).where(eq(areas.id, mgr.area.id));
    expect(after?.archivedAt).not.toBeNull();
    expect((await getTicket(t.id)).status).toBe("available");
    expect((await loadActor(db, mgr.user.id))!.managedAreaIds).toEqual([]);
  });
});

describe("listUserOptions", () => {
  beforeEach(resetDb);

  it("yalnız aktif kullanıcılar ve yalnız id/name/username döner", async () => {
    const admin = await makeMainAdmin();
    await makeUser({ username: "pasif", active: false });
    await makeUser({ username: "aktif", phone: "0532 000 00 00" });
    const opts = await listUserOptions(db, admin);
    expect(opts.map((o) => o.username)).toContain("aktif");
    expect(opts.map((o) => o.username)).not.toContain("pasif");
    for (const o of opts) expect(Object.keys(o).sort()).toEqual(["id", "name", "username"]);
    expect(JSON.stringify(opts)).not.toContain("@example.com");
    expect(JSON.stringify(opts)).not.toContain("0532");
  });
});

describe("alan silme (yalnız boş alan)", () => {
  beforeEach(resetDb);

  const chanOf = (areaId: string) => db.select().from(channels).where(eq(channels.areaId, areaId));
  const areaOf = (areaId: string) => db.select().from(areas).where(eq(areas.id, areaId));

  it("boş alanı kanalı ve okunma kayıtlarıyla siler, denetim kaydı düşer", async () => {
    const admin = await makeMainAdmin();
    const { id } = await createArea(db, admin, { name: "Yanlış açılan" });
    const [ch] = await chanOf(id);
    await db.insert(channelReads).values({ userId: admin.id, channelId: ch!.id, lastReadAt: new Date() });
    await expect(deleteArea(db, admin, { areaId: id })).resolves.toEqual({ deleted: true });
    expect(await areaOf(id)).toHaveLength(0);
    expect(await chanOf(id)).toHaveLength(0);
    expect(await db.select().from(channelReads)).toHaveLength(0);
    const rows = await auditRows("area.delete", id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ areaId: id, name: "Yanlış açılan" });
    // Eski kayıtlar korunur, alana bağlantısı kopar.
    const created = await auditRows("area.create", id);
    expect(created).toHaveLength(1);
    expect(created[0]?.areaId).toBeNull();
  });

  it("yalnız yöneticisi olan ve arşivli boş alan silinir", async () => {
    const admin = await makeMainAdmin();
    const { area } = await makeManagerActor({ archivedAt: new Date(), githubRepo: "alan-x" });
    await expect(deleteArea(db, admin, { areaId: area.id })).resolves.toEqual({ deleted: true });
    expect(await areaOf(area.id)).toHaveLength(0);
  });

  it("ticket varsa (iptal edilmiş bile) silmez ve hiçbir şeyi değiştirmez", async () => {
    const admin = await makeMainAdmin();
    const sprint = await makeActiveSprint();
    const { id } = await createArea(db, admin, { name: "Dolu" });
    await makeTicketRow({ areaId: id, sprintId: sprint.id, createdById: admin.id, status: "cancelled" });
    await expect(deleteArea(db, admin, { areaId: id })).resolves.toEqual({ deleted: false, blockers: { tickets: 1 } });
    expect(await areaOf(id)).toHaveLength(1);
    expect(await chanOf(id)).toHaveLength(1);
    expect(await auditRows("area.delete")).toHaveLength(0);
    expect((await auditRows("area.create", id))[0]?.areaId).toBe(id);
  });

  it("hedef ve roadmap engeller", async () => {
    const admin = await makeMainAdmin();
    const sprint = await makeActiveSprint();
    const a = await makeArea();
    const b = await makeArea();
    await db.insert(goals).values({ sprintId: sprint.id, areaId: a.id, title: "Hedef", createdById: admin.id });
    await db.insert(roadmaps).values({ sprintId: sprint.id, areaId: b.id });
    await expect(deleteArea(db, admin, { areaId: a.id })).resolves.toEqual({ deleted: false, blockers: { goals: 1 } });
    await expect(deleteArea(db, admin, { areaId: b.id })).resolves.toEqual({ deleted: false, blockers: { roadmaps: 1 } });
  });

  it("ana alanı bu olan üye engeller", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    await makeUser({ homeAreaId: area.id });
    await expect(deleteArea(db, admin, { areaId: area.id })).resolves.toEqual({
      deleted: false,
      blockers: { members: 1 },
    });
    expect(await areaOf(area.id)).toHaveLength(1);
  });

  it("kanalında mesaj varsa engeller; çoklu engel sayaçları birlikte döner", async () => {
    const admin = await makeMainAdmin();
    const { id } = await createArea(db, admin, { name: "Konuşulan" });
    const [ch] = await chanOf(id);
    await addMessages(ch!.id, 3, { authorId: admin.id });
    await makeUser({ homeAreaId: id });
    await expect(deleteArea(db, admin, { areaId: id })).resolves.toEqual({
      deleted: false,
      blockers: { members: 1, messages: 3 },
    });
    expect(await chanOf(id)).toHaveLength(1);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "area.delete"))).toHaveLength(0);
  });

  it("yetkisiz çağrı reddedilir, bilinmeyen id NOT_FOUND", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const mgr = await makeManagerActor();
    await expectCode(deleteArea(db, mgr.actor, { areaId: mgr.area.id }), "FORBIDDEN");
    await expectCode(deleteArea(db, await makeActor(), { areaId: area.id }), "FORBIDDEN");
    await expectCode(deleteArea(db, null, { areaId: area.id }), "UNAUTHENTICATED");
    await expectCode(deleteArea(db, admin, { areaId: "00000000-0000-4000-8000-000000000000" }), "NOT_FOUND");
    expect(await areaOf(area.id)).toHaveLength(1);
  });
});
