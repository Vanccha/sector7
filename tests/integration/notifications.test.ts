import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { notificationPrefs, notifications } from "../../src/db/schema";
import { notify } from "../../src/lib/notify";
import { NOTIFICATION_PAGE_SIZE, NOTIFICATION_TYPES } from "../../src/lib/contracts/notifications";
import {
  getNotificationSettings,
  listNotifications,
  markNotificationsRead,
  setNotificationPrefs,
  unreadNotificationCount,
} from "../../src/server/notifications";
import { db, makeActor, resetDb } from "../helpers/db";
import { notifsOf } from "../helpers/cycle";
import { auditRows } from "../helpers/plan";
import { setPref } from "../helpers/messaging";

beforeEach(resetDb);

const send = (userIds: (string | null | undefined)[], type: "mention" | "announcement" = "mention", title = "T") =>
  notify(db, { userIds, type, title, body: "gövde", link: "/x" });

describe("listNotifications", () => {
  it("yalnız kendi bildirimlerini listeler", async () => {
    const a = await makeActor();
    const b = await makeActor();
    await send([a.id]);
    await send([a.id, b.id]);
    const la = await listNotifications(db, a, {});
    const lb = await listNotifications(db, b, {});
    expect(la.items).toHaveLength(2);
    expect(lb.items).toHaveLength(1);
    expect(la.unread).toBe(2);
    expect(lb.unread).toBe(1);
    expect(la.nextCursor).toBeNull();
  });

  it("cursor ile sayfalama: çakışmasız, eksiksiz, yeniden eskiye", async () => {
    const a = await makeActor();
    const total = NOTIFICATION_PAGE_SIZE + 7;
    const base = Date.now() - 3_600_000;
    await db.insert(notifications).values(
      Array.from({ length: total }, (_, i) => ({
        userId: a.id,
        type: "mention",
        title: `n${i + 1}`,
        createdAt: new Date(base + i * 1000),
        pushedAt: new Date(),
      })),
    );
    const p1 = await listNotifications(db, a, {});
    expect(p1.items).toHaveLength(NOTIFICATION_PAGE_SIZE);
    expect(p1.items[0]!.title).toBe(`n${total}`);
    expect(p1.nextCursor).toBe(p1.items[p1.items.length - 1]!.id);
    const p2 = await listNotifications(db, a, { cursor: p1.nextCursor });
    expect(p2.items).toHaveLength(7);
    expect(p2.nextCursor).toBeNull();
    const titles = [...p1.items, ...p2.items].map((n) => n.title);
    expect(new Set(titles).size).toBe(total);
    expect(titles).toEqual(Array.from({ length: total }, (_, i) => `n${total - i}`));
  });

  it("aynı createdAt'te sayfalama çakışmasız", async () => {
    const a = await makeActor();
    const total = NOTIFICATION_PAGE_SIZE + 5;
    await db.insert(notifications).values(
      Array.from({ length: total }, (_, i) => ({ userId: a.id, type: "mention", title: `n${i}`, pushedAt: new Date() })),
    );
    const p1 = await listNotifications(db, a, {});
    const p2 = await listNotifications(db, a, { cursor: p1.nextCursor });
    const ids = [...p1.items, ...p2.items].map((n) => n.id);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  });

  it("onlyUnread okunmuşları süzer", async () => {
    const a = await makeActor();
    await send([a.id], "mention", "bir");
    await send([a.id], "mention", "iki");
    const [first] = (await listNotifications(db, a, {})).items;
    await markNotificationsRead(db, a, { ids: [first!.id] });
    const all = await listNotifications(db, a, {});
    const unread = await listNotifications(db, a, { onlyUnread: true });
    expect(all.items).toHaveLength(2);
    expect(unread.items).toHaveLength(1);
    expect(unread.items[0]!.id).not.toBe(first!.id);
    expect(unread.unread).toBe(1);
  });
});

describe("markNotificationsRead", () => {
  it("başkasının id'sini etkilemez", async () => {
    const a = await makeActor();
    const b = await makeActor();
    await send([a.id, b.id]);
    const bId = (await notifsOf(b.id))[0]!.id;
    await markNotificationsRead(db, a, { ids: [bId] });
    expect((await notifsOf(b.id))[0]!.readAt).toBeNull();
    expect(await unreadNotificationCount(db, b)).toBe(1);
    expect(await unreadNotificationCount(db, a)).toBe(1);
  });

  it("ids boş → yalnız kendi bildirimlerinin tümü", async () => {
    const a = await makeActor();
    const b = await makeActor();
    await send([a.id, b.id]);
    await send([a.id, b.id]);
    await markNotificationsRead(db, a, { ids: [] });
    expect(await unreadNotificationCount(db, a)).toBe(0);
    expect(await unreadNotificationCount(db, b)).toBe(2);
    await markNotificationsRead(db, b, {});
    expect(await unreadNotificationCount(db, b)).toBe(0);
  });

  it("verilen id'leri okundu yapar; okunmuşun readAt'ı değişmez", async () => {
    const a = await makeActor();
    await send([a.id]);
    await send([a.id]);
    const rows = await notifsOf(a.id);
    const t1 = new Date("2026-01-01T00:00:00Z");
    await markNotificationsRead(db, a, { ids: [rows[0]!.id] }, t1);
    await markNotificationsRead(db, a, { ids: [rows[0]!.id] }, new Date("2026-02-01T00:00:00Z"));
    const [r0] = await db.select().from(notifications).where(eq(notifications.id, rows[0]!.id));
    expect(r0!.readAt).toEqual(t1);
    expect(await unreadNotificationCount(db, a)).toBe(1);
  });
});

describe("tercihler", () => {
  it("varsayılan: tüm türlerde inApp ve push true", async () => {
    const a = await makeActor();
    const s = await getNotificationSettings(db, a);
    expect(s.prefs.map((p) => p.type)).toEqual([...NOTIFICATION_TYPES]);
    for (const p of s.prefs) expect(p).toMatchObject({ inApp: true, push: true });
    expect(s.push.deviceCount).toBe(0);
  });

  it("setNotificationPrefs upsert eder ve yalnız değişenleri denetler", async () => {
    const a = await makeActor();
    await setNotificationPrefs(db, a, {
      prefs: [
        { type: "mention", inApp: false, push: true },
        { type: "announcement", inApp: true, push: true }, // değişmedi
      ],
    });
    let s = await getNotificationSettings(db, a);
    expect(s.prefs.find((p) => p.type === "mention")).toMatchObject({ inApp: false, push: true });
    expect(s.prefs.find((p) => p.type === "announcement")).toMatchObject({ inApp: true, push: true });
    const rows = await auditRows("notification.prefs_update");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(a.id);
    expect(rows[0]!.data).toEqual({ types: ["mention"] });

    // Aynı değer: yeni denetim yok; güncelleme: upsert (tek satır).
    await setNotificationPrefs(db, a, { prefs: [{ type: "mention", inApp: false, push: true }] });
    expect(await auditRows("notification.prefs_update")).toHaveLength(1);
    await setNotificationPrefs(db, a, { prefs: [{ type: "mention", inApp: false, push: false }] });
    s = await getNotificationSettings(db, a);
    expect(s.prefs.find((p) => p.type === "mention")).toMatchObject({ inApp: false, push: false });
    expect(await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, a.id))).toHaveLength(1);
    expect(await auditRows("notification.prefs_update")).toHaveLength(2);
  });

  it("tercihler kişiye özel", async () => {
    const a = await makeActor();
    const b = await makeActor();
    await setNotificationPrefs(db, a, { prefs: [{ type: "mention", inApp: false, push: false }] });
    const sb = await getNotificationSettings(db, b);
    expect(sb.prefs.find((p) => p.type === "mention")).toMatchObject({ inApp: true, push: true });
  });
});

describe("notify() tercih kuralları", () => {
  it("varsayılan: okunmamış ve kuyrukta (pushedAt boş)", async () => {
    const a = await makeActor();
    expect(await send([a.id])).toBe(1);
    const [n] = await notifsOf(a.id);
    expect(n).toMatchObject({ readAt: null, pushedAt: null, type: "mention", title: "T", body: "gövde", link: "/x" });
  });

  it("inApp=false ve push=false → hiç satır yazılmaz", async () => {
    const a = await makeActor();
    await setPref(a.id, "mention", false, false);
    expect(await send([a.id])).toBe(0);
    expect(await notifsOf(a.id)).toHaveLength(0);
  });

  it("inApp=false ve push=true → satır push için yazılır, readAt dolu (rozet artmaz), pushedAt boş", async () => {
    const a = await makeActor();
    await setPref(a.id, "mention", false, true);
    expect(await send([a.id])).toBe(1);
    const [n] = await notifsOf(a.id);
    expect(n!.readAt).not.toBeNull();
    expect(n!.pushedAt).toBeNull();
    expect(await unreadNotificationCount(db, a)).toBe(0);
    expect((await listNotifications(db, a, { onlyUnread: true })).items).toHaveLength(0);
  });

  it("push=false → pushedAt dolu doğar (kuyruğa girmez), inApp açıksa okunmamış", async () => {
    const a = await makeActor();
    await setPref(a.id, "mention", true, false);
    await send([a.id]);
    const [n] = await notifsOf(a.id);
    expect(n!.pushedAt).not.toBeNull();
    expect(n!.readAt).toBeNull();
    expect(await unreadNotificationCount(db, a)).toBe(1);
  });

  it("tercih yalnız o türe uygulanır; tekrarlar ve null/undefined kimlikler yok sayılır", async () => {
    const a = await makeActor();
    const b = await makeActor();
    await setPref(a.id, "mention", false, false);
    expect(await send([a.id, b.id, b.id, null, undefined], "announcement")).toBe(2);
    expect(await notifsOf(a.id)).toHaveLength(1);
    expect(await notifsOf(b.id)).toHaveLength(1);
    expect(await send([null, undefined])).toBe(0);
  });
});
