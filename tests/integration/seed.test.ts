import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { seed, SAMPLE_AREAS } from "../../src/db/seed";
import { areas, channels, settings, sprints, user } from "../../src/db/schema";
import { db, resetDb } from "../helpers/db";

async function counts() {
  return {
    areas: (await db.select().from(areas)).length,
    areaChannels: (await db.select().from(channels).where(eq(channels.kind, "area"))).length,
    announcement: (await db.select().from(channels).where(eq(channels.kind, "announcement"))).length,
    sprints: (await db.select().from(sprints)).length,
    active: (await db.select().from(sprints).where(eq(sprints.status, "active"))).length,
    settings: (await db.select().from(settings)).length,
    users: (await db.select().from(user)).length,
  };
}

const admin = { username: "kurucu", name: "Kurucu", email: "kurucu@example.com", password: "cok-guclu-sifre-1" };

describe("seed", () => {
  beforeEach(resetDb);

  it("ilk çalıştırma beklenen veriyi kurar", async () => {
    await seed(db, { admin });
    const c = await counts();
    expect(c.areas).toBe(SAMPLE_AREAS.length);
    expect(c.areaChannels).toBe(SAMPLE_AREAS.length);
    expect(c.announcement).toBe(1);
    expect(c.sprints).toBe(1);
    expect(c.active).toBe(1);
    expect(c.settings).toBeGreaterThan(0);
    expect(c.users).toBe(1);
  });

  it("iki kez çalışınca sayılar değişmez", async () => {
    await seed(db, { admin });
    const first = await counts();
    await seed(db, { admin });
    expect(await counts()).toEqual(first);
  });

  it("yönetici verilmeden de idempotenttir", async () => {
    await seed(db);
    const first = await counts();
    await seed(db);
    expect(await counts()).toEqual(first);
    expect(first.users).toBe(0);
  });
});
