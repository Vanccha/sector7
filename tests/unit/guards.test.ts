import { describe, expect, it } from "vitest";
import {
  canAnnounce,
  canManageArea,
  canViewPersonalData,
  requireActor,
  requireAreaManager,
  requireMainAdmin,
} from "../../src/lib/auth/guards";
import { rolesOf, type Actor } from "../../src/lib/contracts/actor";
import { AppError } from "../../src/lib/contracts/errors";

const base: Actor = {
  id: "u1",
  username: "u1",
  name: "U",
  isMainAdmin: false,
  canAnnounce: false,
  homeAreaId: null,
  managedAreaIds: [],
};
const member = base;
const manager: Actor = { ...base, id: "m", managedAreaIds: ["A1"] };
const admin: Actor = { ...base, id: "a", isMainAdmin: true };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : "OTHER";
  }
  return undefined;
}

describe("requireActor", () => {
  it("oturum yoksa UNAUTHENTICATED", () => {
    expect(codeOf(() => requireActor(null))).toBe("UNAUTHENTICATED");
  });
  it("oturum varsa aktörü döndürür", () => {
    expect(requireActor(member)).toBe(member);
  });
});

describe("requireMainAdmin", () => {
  it("ana yönetici geçer", () => {
    expect(requireMainAdmin(admin)).toBe(admin);
  });
  it("üye FORBIDDEN", () => {
    expect(codeOf(() => requireMainAdmin(member))).toBe("FORBIDDEN");
  });
  it("alan yöneticisi FORBIDDEN", () => {
    expect(codeOf(() => requireMainAdmin(manager))).toBe("FORBIDDEN");
  });
  it("null UNAUTHENTICATED", () => {
    expect(codeOf(() => requireMainAdmin(null))).toBe("UNAUTHENTICATED");
  });
});

describe("canManageArea / requireAreaManager", () => {
  it("alan yöneticisi kendi alanını yönetir", () => {
    expect(canManageArea(manager, "A1")).toBe(true);
    expect(requireAreaManager(manager, "A1")).toBe(manager);
  });
  it("alan yöneticisi başka alanı yönetemez", () => {
    expect(canManageArea(manager, "A2")).toBe(false);
    expect(codeOf(() => requireAreaManager(manager, "A2"))).toBe("FORBIDDEN");
  });
  it("ana yönetici her alanı yönetir", () => {
    expect(canManageArea(admin, "A9")).toBe(true);
    expect(requireAreaManager(admin, "A9")).toBe(admin);
  });
  it("üye hiçbir alanı yönetemez", () => {
    expect(canManageArea(member, "A1")).toBe(false);
    expect(codeOf(() => requireAreaManager(member, "A1"))).toBe("FORBIDDEN");
  });
  it("null: false ve UNAUTHENTICATED", () => {
    expect(canManageArea(null, "A1")).toBe(false);
    expect(codeOf(() => requireAreaManager(null, "A1"))).toBe("UNAUTHENTICATED");
  });
});

describe("canViewPersonalData", () => {
  it("yalnız ana yönetici", () => {
    expect(canViewPersonalData(admin)).toBe(true);
    expect(canViewPersonalData(manager)).toBe(false);
    expect(canViewPersonalData(member)).toBe(false);
    expect(canViewPersonalData(null)).toBe(false);
  });
});

describe("canAnnounce", () => {
  it("ana yönetici ve duyuru yetkilisi yazabilir", () => {
    expect(canAnnounce(admin)).toBe(true);
    expect(canAnnounce({ ...member, canAnnounce: true })).toBe(true);
  });
  it("üye, alan yöneticisi ve null yazamaz", () => {
    expect(canAnnounce(member)).toBe(false);
    expect(canAnnounce(manager)).toBe(false);
    expect(canAnnounce(null)).toBe(false);
  });
});

describe("rolesOf", () => {
  it("herkes üyedir", () => {
    expect(rolesOf(member)).toEqual(["member"]);
  });
  it("alan yöneticisi hem alan yöneticisi hem üyedir", () => {
    expect(rolesOf(manager)).toEqual(["area_manager", "member"]);
  });
  it("bir kişi birden çok role sahip olabilir", () => {
    expect(rolesOf({ ...admin, managedAreaIds: ["A1"] })).toEqual(["main_admin", "area_manager", "member"]);
  });
});
