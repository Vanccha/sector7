import { beforeEach, describe, expect, it } from "vitest";
import { settings as settingsTable } from "../../src/db/schema";
import { DEFAULT_SETTINGS } from "../../src/lib/contracts/settings";
import { getSettings } from "../../src/lib/settings";
import { acceptOffer } from "../../src/server/pool";
import { getSettingsView, updateSettings } from "../../src/server/settings-admin";
import { db, resetDb } from "../helpers/db";
import { H, MIN, T0, at, expectValidation, setSetting, setupCycle, ticketById } from "../helpers/cycle";
import { expectMainAdminOnly } from "../helpers/admin";
import { auditRows, makeTicketRow } from "../helpers/plan";

beforeEach(resetDb);

const valid = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over });

describe("ayarlar: yetki", () => {
  it("getSettingsView ve updateSettings yalnız ana yönetici", async () => {
    const c = await setupCycle();
    await expectMainAdminOnly(c, (a) => getSettingsView(db, a));
    await expectMainAdminOnly(c, (a) => updateSettings(db, a, valid({ ticketHours: 10 })));
    expect((await getSettings(db)).ticketHours).toBe(DEFAULT_SETTINGS.ticketHours);
    expect(await db.select().from(settingsTable)).toHaveLength(0);
  });
});

describe("getSettingsView", () => {
  it("kayıt yokken değerler varsayılanlardır; updatedAt/updatedBy null", async () => {
    const c = await setupCycle();
    const v = await getSettingsView(db, c.admin);
    expect(v.values).toEqual(DEFAULT_SETTINGS);
    expect(v.defaults).toEqual(DEFAULT_SETTINGS);
    expect(v.updatedAt).toBeNull();
    expect(v.updatedBy).toBeNull();
  });

  it("kayıtlı değerler varsayılanların üstüne biner; defaults değişmez; son güncelleyen görünür", async () => {
    const c = await setupCycle();
    await updateSettings(db, c.admin, valid({ ticketHours: 48, uploadMaxMb: 25 }), T0);
    const v = await getSettingsView(db, c.admin);
    expect(v.values).toEqual(valid({ ticketHours: 48, uploadMaxMb: 25 }));
    expect(v.defaults).toEqual(DEFAULT_SETTINGS);
    expect(v.updatedAt).toBe(T0.toISOString());
    expect(v.updatedBy?.id).toBe(c.admin.id);
  });
});

describe("updateSettings", () => {
  it("sınır dışı değerler doğrulama hatası verir ve hiçbir şey yazmaz", async () => {
    const c = await setupCycle();
    const bad: Partial<typeof DEFAULT_SETTINGS>[] = [
      { sprintLengthDays: 2 },
      { sprintLengthDays: 91 },
      { ticketHours: 0 },
      { ticketHours: 24 * 30 + 1 },
      { ticketWarnBeforeHours: 0 },
      { ticketWarnBeforeHours: 73 },
      { managerResponseHours: 0 },
      { managerResponseHours: 24 * 14 + 1 },
      { rejectionsPerSprint: -1 },
      { rejectionsPerSprint: 21 },
      { uploadMaxMb: 0 },
      { uploadMaxMb: 501 },
      { ticketHours: 1.5 },
      { ticketHours: "72" as unknown as number },
    ];
    for (const b of bad) await expectValidation(updateSettings(db, c.admin, valid(b)));
    // Eksik anahtar da geçersiz.
    const { uploadMaxMb: _omit, ...partial } = DEFAULT_SETTINGS;
    void _omit;
    await expectValidation(updateSettings(db, c.admin, partial));
    expect(await db.select().from(settingsTable)).toHaveLength(0);
    expect(await auditRows("settings.update")).toHaveLength(0);
  });

  it("sınır değerleri kabul edilir", async () => {
    const c = await setupCycle();
    await updateSettings(db, c.admin, {
      sprintLengthDays: 3,
      ticketHours: 24 * 30,
      ticketWarnBeforeHours: 72,
      managerResponseHours: 1,
      rejectionsPerSprint: 0,
      uploadMaxMb: 500,
      uploadsEnabled: true,
    });
    expect(await getSettings(db)).toEqual({
      sprintLengthDays: 3,
      ticketHours: 720,
      ticketWarnBeforeHours: 72,
      managerResponseHours: 1,
      rejectionsPerSprint: 0,
      uploadMaxMb: 500,
      uploadsEnabled: true,
    });
  });

  it("yalnız değişen anahtarlar yazılır; settings.update kaydı data.changes {from,to}", async () => {
    const c = await setupCycle();
    await updateSettings(db, c.admin, valid({ ticketHours: 48, rejectionsPerSprint: 5 }));
    const rows = await db.select().from(settingsTable);
    expect(rows.map((r) => r.key).sort()).toEqual(["rejectionsPerSprint", "ticketHours"]);
    const log = await auditRows("settings.update");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: c.admin.id, entityType: "settings" });
    expect(log[0]!.data).toEqual({
      changes: { ticketHours: { from: 72, to: 48 }, rejectionsPerSprint: { from: 2, to: 5 } },
    });

    // İkinci kayıtta önceki değer "from" olur; dokunulmayan anahtar tabloya girmez.
    await updateSettings(db, c.admin, valid({ ticketHours: 96, rejectionsPerSprint: 5 }));
    const log2 = await auditRows("settings.update");
    expect(log2).toHaveLength(2);
    const last = log2.sort((a, b) => a.id - b.id)[1]!;
    expect(last.data).toEqual({ changes: { ticketHours: { from: 48, to: 96 } } });
    expect((await db.select().from(settingsTable)).map((r) => r.key).sort()).toEqual(["rejectionsPerSprint", "ticketHours"]);
  });

  it("değişiklik yoksa kayıt yazılmaz (varsayılanlarla aynı gönderim dahil)", async () => {
    const c = await setupCycle();
    await updateSettings(db, c.admin, valid());
    expect(await auditRows("settings.update")).toHaveLength(0);
    expect(await db.select().from(settingsTable)).toHaveLength(0);
    await setSetting("ticketHours", 48);
    await updateSettings(db, c.admin, valid({ ticketHours: 48 }));
    expect(await auditRows("settings.update")).toHaveLength(0);
  });

  it("getSettings yeni değeri döndürür", async () => {
    const c = await setupCycle();
    await updateSettings(db, c.admin, valid({ managerResponseHours: 6, sprintLengthDays: 14 }));
    const s = await getSettings(db);
    expect(s.managerResponseHours).toBe(6);
    expect(s.sprintLengthDays).toBe(14);
    expect(s.ticketHours).toBe(72);
  });
});

describe("ticketHours değişikliği yalnız sonraki işlemlere uygulanır", () => {
  it("var olan taken ticket'ın dueAt'i değişmez; sonraki kabul yeni değeri kullanır", async () => {
    const c = await setupCycle();
    const mkOffer = () =>
      makeTicketRow({
        areaId: c.areaA.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "offered", assigneeId: c.member.id, offeredAt: T0,
      });
    const first = await mkOffer();
    await acceptOffer(db, c.member, { ticketId: first.id }, at(MIN));
    const before = await ticketById(first.id);
    expect(before.dueAt).toEqual(at(MIN + 72 * H));

    await updateSettings(db, c.admin, valid({ ticketHours: 24 }), at(2 * MIN));
    expect((await ticketById(first.id)).dueAt).toEqual(before.dueAt);

    const second = await mkOffer();
    await acceptOffer(db, c.member, { ticketId: second.id }, at(3 * MIN));
    expect((await ticketById(second.id)).dueAt).toEqual(at(3 * MIN + 24 * H));
    // Birincisi hâlâ eski süreyle.
    expect((await ticketById(first.id)).dueAt).toEqual(before.dueAt);
  });
});
