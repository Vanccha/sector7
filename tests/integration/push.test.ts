import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notifications, pushSubscriptions } from "../../src/db/schema";
import { notify } from "../../src/lib/notify";
import {
  dispatchPendingPush,
  removePushSubscription,
  savePushSubscription,
  type PushSender,
} from "../../src/server/push";
import { db, makeActor, resetDb } from "../helpers/db";
import { notifsOf } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { expectValidation } from "../helpers/cycle";
import { setPref } from "../helpers/messaging";

beforeEach(resetDb);

const keys = { p256dh: "BKey_p256dh_0123456789", auth: "authkey1234" };
const sub = (endpoint: string) => ({ endpoint, keys });

async function addSub(userId: string, endpoint: string) {
  const [r] = await db.insert(pushSubscriptions).values({ userId, endpoint, ...keys }).returning();
  return r!;
}

const mention = (userIds: string[], title = "T") =>
  notify(db, { userIds, type: "mention", title, body: "b", link: "/l" });

function recorder(result: Awaited<ReturnType<PushSender>> = { ok: true }) {
  const calls: { endpoint: string; title: string }[] = [];
  const sender: PushSender = async (s, p) => {
    calls.push({ endpoint: s.endpoint, title: p.title });
    return result;
  };
  return { calls, sender };
}

describe("abonelik", () => {
  it("savePushSubscription kaydeder; aynı endpoint başka kullanıcıya geçer (upsert)", async () => {
    const a = await makeActor();
    const b = await makeActor();
    const ep = "https://push.example.com/abc";
    await savePushSubscription(db, a, sub(ep));
    await savePushSubscription(db, a, sub(ep));
    let rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(a.id);
    await savePushSubscription(db, b, sub(ep));
    rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(b.id);
  });

  it("http olmayan / geçersiz endpoint doğrulama hatası; localhost http serbest", async () => {
    const a = await makeActor();
    await expectValidation(savePushSubscription(db, a, sub("http://example.com/x")));
    await expectValidation(savePushSubscription(db, a, sub("ftp://example.com/x")));
    await expectValidation(savePushSubscription(db, a, sub("bu bir url değil")));
    await expectValidation(savePushSubscription(db, a, { endpoint: "https://push.example.com/x", keys: { p256dh: "a", auth: "b" } }));
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
    await savePushSubscription(db, a, sub("http://localhost:9999/x"));
    await savePushSubscription(db, a, sub("https://push.example.com/y"));
    expect(await db.select().from(pushSubscriptions)).toHaveLength(2);
  });

  it("giriş yapmamış kullanıcı kaydedemez", async () => {
    await expectCode(savePushSubscription(db, null, sub("https://push.example.com/z")), "UNAUTHENTICATED");
  });

  it("removePushSubscription yalnız kendi aboneliğini siler", async () => {
    const a = await makeActor();
    const b = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    await removePushSubscription(db, b, { endpoint: "https://push.example.com/a" });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
    await removePushSubscription(db, a, { endpoint: "https://push.example.com/a" });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe("dispatchPendingPush", () => {
  it("bekleyen satırı gönderir, pushedAt doldurur; ikinci çağrı tekrar göndermez", async () => {
    const a = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    await mention([a.id], "merhaba");
    const { calls, sender } = recorder();
    const r1 = await dispatchPendingPush(db, new Date(), sender);
    expect(r1).toMatchObject({ skipped: false, claimed: 1, sent: 1, removed: 0 });
    expect(calls).toEqual([{ endpoint: "https://push.example.com/a", title: "merhaba" }]);
    expect((await notifsOf(a.id))[0]!.pushedAt).not.toBeNull();
    const r2 = await dispatchPendingPush(db, new Date(), sender);
    expect(r2).toMatchObject({ claimed: 0, sent: 0 });
    expect(calls).toHaveLength(1);
  });

  it("birden çok cihaza gönderir", async () => {
    const a = await makeActor();
    await addSub(a.id, "https://push.example.com/1");
    await addSub(a.id, "https://push.example.com/2");
    await mention([a.id]);
    const { calls, sender } = recorder();
    await dispatchPendingPush(db, new Date(), sender);
    expect(calls.map((c) => c.endpoint).sort()).toEqual(["https://push.example.com/1", "https://push.example.com/2"]);
  });

  it("1 saatten eski satırlar gönderilmez (pushedAt boş kalır)", async () => {
    const a = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    const now = new Date();
    const [old] = await db
      .insert(notifications)
      .values({ userId: a.id, type: "mention", title: "eski", createdAt: new Date(now.getTime() - 2 * 3_600_000) })
      .returning();
    const [fresh] = await db
      .insert(notifications)
      .values({ userId: a.id, type: "mention", title: "yeni", createdAt: new Date(now.getTime() - 30 * 60_000) })
      .returning();
    const { calls, sender } = recorder();
    await dispatchPendingPush(db, now, sender);
    expect(calls.map((c) => c.title)).toEqual(["yeni"]);
    const get = async (id: string) => (await db.select().from(notifications).where(eq(notifications.id, id)))[0]!;
    expect((await get(old!.id)).pushedAt).toBeNull();
    expect((await get(fresh!.id)).pushedAt).not.toBeNull();
  });

  it("push=false tercihli kişinin bildirimi kuyruğa girmez", async () => {
    const a = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    await setPref(a.id, "mention", true, false);
    await mention([a.id]);
    const { calls, sender } = recorder();
    const r = await dispatchPendingPush(db, new Date(), sender);
    expect(r.claimed).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("inApp=false push=true: satır gönderilir (readAt dolu olsa da)", async () => {
    const a = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    await setPref(a.id, "mention", false, true);
    await mention([a.id]);
    const { calls, sender } = recorder();
    await dispatchPendingPush(db, new Date(), sender);
    expect(calls).toHaveLength(1);
  });

  it("aboneliği olmayan kişinin satırı işaretlenir ama sender çağrılmaz", async () => {
    const a = await makeActor();
    await mention([a.id]);
    const { calls, sender } = recorder();
    const r = await dispatchPendingPush(db, new Date(), sender);
    expect(r).toMatchObject({ claimed: 1, sent: 0 });
    expect(calls).toHaveLength(0);
    expect((await notifsOf(a.id))[0]!.pushedAt).not.toBeNull();
  });

  it("sender gone dönerse abonelik silinir; başarısız-gone-olmayan abonelik kalır", async () => {
    const a = await makeActor();
    const b = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    await addSub(b.id, "https://push.example.com/b");
    await mention([a.id, b.id]);
    const sender: PushSender = async (s) =>
      s.endpoint.endsWith("/a") ? { ok: false, gone: true } : { ok: false, gone: false };
    const r = await dispatchPendingPush(db, new Date(), sender);
    expect(r.removed).toBe(1);
    const rest = await db.select().from(pushSubscriptions);
    expect(rest.map((s) => s.endpoint)).toEqual(["https://push.example.com/b"]);
  });

  it("sender hata fırlatsa da süreç düşmez, satır işaretli kalır", async () => {
    const a = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    await mention([a.id]);
    const sender: PushSender = async () => {
      throw new Error("ağ hatası");
    };
    const r = await dispatchPendingPush(db, new Date(), sender);
    expect(r).toMatchObject({ skipped: false, claimed: 1, sent: 0 });
    expect((await notifsOf(a.id))[0]!.pushedAt).not.toBeNull();
  });

  it("eşzamanlı iki dispatch aynı satırı iki kez göndermez", async () => {
    const users = await Promise.all(Array.from({ length: 6 }, () => makeActor()));
    for (const u of users) await addSub(u.id, `https://push.example.com/${u.id}`);
    for (let i = 0; i < 3; i++) await mention(users.map((u) => u.id), `n${i}`);
    const calls: string[] = [];
    const sender: PushSender = async (s, p) => {
      await new Promise((r) => setTimeout(r, 5));
      calls.push(`${s.endpoint}|${p.title}`);
      return { ok: true };
    };
    const [r1, r2] = await Promise.all([
      dispatchPendingPush(db, new Date(), sender),
      dispatchPendingPush(db, new Date(), sender),
    ]);
    expect(calls).toHaveLength(18);
    expect(new Set(calls).size).toBe(18);
    expect(r1.claimed + r2.claimed).toBe(18);
  });
});

describe("VAPID yapılandırması yokken", () => {
  const KEYS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("sender verilmezse skipped: true ve hiçbir satır işaretlenmez", async () => {
    const a = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    await mention([a.id]);
    const r = await dispatchPendingPush(db, new Date());
    expect(r).toEqual({ skipped: true, claimed: 0, sent: 0, removed: 0 });
    expect((await notifsOf(a.id))[0]!.pushedAt).toBeNull();
  });

  it("sahte sender verilirse yapılandırma olmadan da çalışır", async () => {
    const a = await makeActor();
    await addSub(a.id, "https://push.example.com/a");
    await mention([a.id]);
    const { calls, sender } = recorder();
    const r = await dispatchPendingPush(db, new Date(), sender);
    expect(r.skipped).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
