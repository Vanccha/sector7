import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { applications, auditLog, user } from "../../src/db/schema";
import { consumePasswordToken } from "../../src/server/accounts";
import {
  approveApplication,
  listApplications,
  rejectApplication,
  submitApplication,
} from "../../src/server/applications";
import { authRequest, db, makeActor, makeArea, makeMainAdmin, makeUser, resetDb } from "../helpers/db";
import { expectCode } from "../helpers/errors";

const input = (over: Record<string, string> = {}) => ({
  fullName: "Ayşe Yılmaz",
  username: "ayse",
  email: "ayse@example.com",
  phone: "0532 123 45 67",
  intro: "Yazılım ve tasarım ile ilgileniyorum, topluluğa katkı vermek istiyorum.",
  ...over,
});

async function auditCount(action: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.action, action));
  return rows.length;
}

describe("başvuru gönderme", () => {
  beforeEach(resetDb);

  it("oturumsuz herkes başvurabilir ve denetim kaydı düşer", async () => {
    const { id } = await submitApplication(db, input());
    const [row] = await db.select().from(applications).where(eq(applications.id, id));
    expect(row?.status).toBe("pending");
    expect(row?.username).toBe("ayse");
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "application.submit"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.entityId).toBe(id);
  });

  it("var olan hesabın kullanıcı adıyla başvuru CONFLICT", async () => {
    await makeUser({ username: "ayse" });
    await expectCode(submitApplication(db, input()), "CONFLICT");
  });

  it("aynı kullanıcı adıyla ikinci bekleyen başvuru CONFLICT", async () => {
    await submitApplication(db, input());
    await expectCode(submitApplication(db, input({ email: "baska@example.com" })), "CONFLICT");
  });

  it("eşzamanlı iki aynı kullanıcı adlı başvurudan yalnız biri kaydolur", async () => {
    const res = await Promise.allSettled([
      submitApplication(db, input()),
      submitApplication(db, input({ email: "baska@example.com" })),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason.code).toBe("CONFLICT");
    const rows = await db.select().from(applications).where(eq(applications.username, "ayse"));
    expect(rows).toHaveLength(1);
  });
});

describe("listApplications", () => {
  beforeEach(resetDb);

  it("ana yönetici listeler ve personal_data.view kaydı düşer", async () => {
    const admin = await makeMainAdmin();
    await submitApplication(db, input());
    const rows = await listApplications(db, admin);
    expect(rows).toHaveLength(1);
    expect(await auditCount("personal_data.view")).toBe(1);
  });

  it("üye FORBIDDEN", async () => {
    const m = await makeActor();
    await expectCode(listApplications(db, m), "FORBIDDEN");
  });

  it("alan yöneticisi FORBIDDEN", async () => {
    const mgr = await makeUser();
    await makeArea({ managerId: mgr.id });
    const { loadActor } = await import("../../src/lib/auth/guards");
    const actor = await loadActor(db, mgr.id);
    expect(actor?.managedAreaIds).toHaveLength(1);
    await expectCode(listApplications(db, actor), "FORBIDDEN");
  });

  it("oturumsuz UNAUTHENTICATED", async () => {
    await expectCode(listApplications(db, null), "UNAUTHENTICATED");
  });

  it("reddedilmiş olanlar ayrı durumla listelenir", async () => {
    const admin = await makeMainAdmin();
    const { id } = await submitApplication(db, input());
    await rejectApplication(db, admin, { applicationId: id });
    expect(await listApplications(db, admin, "pending")).toHaveLength(0);
    expect(await listApplications(db, admin, "rejected")).toHaveLength(1);
  });
});

describe("approveApplication", () => {
  beforeEach(resetDb);

  it("hesabı açar, başvuruyu onaylar ve /sifre/ bağlantısı döner", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const { id } = await submitApplication(db, input());
    const res = await approveApplication(db, admin, { applicationId: id, homeAreaId: area.id });
    expect(res.setupUrl).toContain("/sifre/");
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [u] = await db.select().from(user).where(eq(user.id, res.userId));
    expect(u?.username).toBe("ayse");
    expect(u?.email).toBe("ayse@example.com");
    expect(u?.phone).toBe("05321234567");
    expect(u?.homeAreaId).toBe(area.id);
    expect(u?.isMainAdmin).toBe(false);

    const [app] = await db.select().from(applications).where(eq(applications.id, id));
    expect(app?.status).toBe("approved");
    expect(app?.createdUserId).toBe(res.userId);
    expect(app?.reviewedById).toBe(admin.id);
    expect(await auditCount("application.approve")).toBe(1);
  });

  it("üye FORBIDDEN, oturumsuz UNAUTHENTICATED; hesap açılmaz", async () => {
    const m = await makeActor();
    const area = await makeArea();
    const { id } = await submitApplication(db, input());
    await expectCode(approveApplication(db, m, { applicationId: id, homeAreaId: area.id }), "FORBIDDEN");
    await expectCode(approveApplication(db, null, { applicationId: id, homeAreaId: area.id }), "UNAUTHENTICATED");
    const rows = await db.select().from(user).where(eq(user.username, "ayse"));
    expect(rows).toHaveLength(0);
  });

  it("alan yöneticisi FORBIDDEN", async () => {
    const mgrUser = await makeUser();
    const area = await makeArea({ managerId: mgrUser.id });
    const { loadActor } = await import("../../src/lib/auth/guards");
    const mgr = await loadActor(db, mgrUser.id);
    const { id } = await submitApplication(db, input());
    await expectCode(approveApplication(db, mgr, { applicationId: id, homeAreaId: area.id }), "FORBIDDEN");
  });

  it("arşivlenmiş alan INVALID_STATE ve başvuru bekleyen kalır", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea({ archivedAt: new Date() });
    const { id } = await submitApplication(db, input());
    await expectCode(approveApplication(db, admin, { applicationId: id, homeAreaId: area.id }), "INVALID_STATE");
    const [app] = await db.select().from(applications).where(eq(applications.id, id));
    expect(app?.status).toBe("pending");
    expect(await db.select().from(user).where(eq(user.username, "ayse"))).toHaveLength(0);
  });

  it("ikinci kez onay INVALID_STATE", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const { id } = await submitApplication(db, input());
    await approveApplication(db, admin, { applicationId: id, homeAreaId: area.id });
    await expectCode(approveApplication(db, admin, { applicationId: id, homeAreaId: area.id }), "INVALID_STATE");
  });

  it("eşzamanlı iki onaydan yalnız biri başarılı, tek hesap açılır", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const { id } = await submitApplication(db, input());
    const res = await Promise.allSettled([
      approveApplication(db, admin, { applicationId: id, homeAreaId: area.id }),
      approveApplication(db, admin, { applicationId: id, homeAreaId: area.id }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rej = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rej[0]!.reason.code).toBe("INVALID_STATE");
    expect(await db.select().from(user).where(eq(user.username, "ayse"))).toHaveLength(1);
  });

  it("onaydan sonra hesap şifresizdir; bağlantıyla şifre belirlenince giriş yapılır", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const { id } = await submitApplication(db, input());
    const res = await approveApplication(db, admin, { applicationId: id, homeAreaId: area.id });

    const before = await authRequest("/sign-in/username", { username: "ayse", password: "herhangi-bir-sifre-1" });
    expect(before.status).toBe(401);

    const token = res.setupUrl.split("/sifre/")[1]!;
    await consumePasswordToken(db, token, "yeni-guclu-sifre-1");

    const after = await authRequest("/sign-in/username", { username: "ayse", password: "yeni-guclu-sifre-1" });
    expect(after.status).toBe(200);
  });
});

describe("rejectApplication", () => {
  beforeEach(resetDb);

  it("kaydı silmez, rejected ve notu saklar", async () => {
    const admin = await makeMainAdmin();
    const { id } = await submitApplication(db, input());
    await rejectApplication(db, admin, { applicationId: id, note: "Şimdilik uygun değil" });
    const [app] = await db.select().from(applications).where(eq(applications.id, id));
    expect(app?.status).toBe("rejected");
    expect(app?.reviewNote).toBe("Şimdilik uygun değil");
    expect(app?.reviewedById).toBe(admin.id);
    expect(await auditCount("application.reject")).toBe(1);
    expect(await db.select().from(user).where(eq(user.username, "ayse"))).toHaveLength(0);
  });

  it("üye FORBIDDEN, oturumsuz UNAUTHENTICATED", async () => {
    const m = await makeActor();
    const { id } = await submitApplication(db, input());
    await expectCode(rejectApplication(db, m, { applicationId: id }), "FORBIDDEN");
    await expectCode(rejectApplication(db, null, { applicationId: id }), "UNAUTHENTICATED");
    const [app] = await db.select().from(applications).where(and(eq(applications.id, id)));
    expect(app?.status).toBe("pending");
  });

  it("sonuçlanmış başvuru tekrar reddedilemez ya da onaylanamaz", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const { id } = await submitApplication(db, input());
    await rejectApplication(db, admin, { applicationId: id });
    await expectCode(rejectApplication(db, admin, { applicationId: id }), "INVALID_STATE");
    await expectCode(approveApplication(db, admin, { applicationId: id, homeAreaId: area.id }), "INVALID_STATE");
  });

  it("onaylanmış başvuru reddedilemez", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const { id } = await submitApplication(db, input());
    await approveApplication(db, admin, { applicationId: id, homeAreaId: area.id });
    await expectCode(rejectApplication(db, admin, { applicationId: id }), "INVALID_STATE");
  });

  it("reddedilen kullanıcı adıyla yeniden başvurulabilir", async () => {
    const admin = await makeMainAdmin();
    const { id } = await submitApplication(db, input());
    await rejectApplication(db, admin, { applicationId: id });
    await expect(submitApplication(db, input())).resolves.toBeTruthy();
  });
});
