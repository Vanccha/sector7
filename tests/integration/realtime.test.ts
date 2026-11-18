import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { notify } from "../../src/lib/notify";
import { NOTIFY_FANOUT_LIMIT, type ServerEvent } from "../../src/lib/contracts/realtime";
import { sendMessage } from "../../src/server/messaging";
import { publishEvent } from "../../src/server/realtime/publish";
import { subscribeEvents } from "../../src/server/realtime/hub";
import { createRequest } from "../../src/server/ticket-requests";
import { db, resetDb } from "../helpers/db";
import { at, setupCycle, takenTicket } from "../helpers/cycle";
import { areaChannelId, makeManyUsers, openListener, setupTicketChannel } from "../helpers/messaging";

type Listener = Awaited<ReturnType<typeof openListener>>;
let L: Listener;

beforeEach(async () => {
  await resetDb();
  L = await openListener();
});
afterEach(async () => {
  await L.close();
});

const isMsg = (e: ServerEvent): e is Extract<ServerEvent, { kind: "message" }> => e.kind === "message";
const isNotif = (e: ServerEvent): e is Extract<ServerEvent, { kind: "notification" }> => e.kind === "notification";

describe("message olayı", () => {
  it("alan kanalında sendMessage commit'ten sonra olay üretir", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    const { messageId } = await sendMessage(db, c.member, { channelId: ch, body: "merhaba" });
    const e = await L.waitFor((x): x is Extract<ServerEvent, { kind: "message" }> => isMsg(x) && x.messageId === messageId);
    expect(e).toMatchObject({
      kind: "message",
      channelId: ch,
      channelKind: "area",
      messageId,
      authorId: c.member.id,
      ticketId: null,
      ticketAssigneeId: null,
      areaId: c.areaA.id,
    });
  });

  it("ticket kanalında ticketAssigneeId ve ticketId taşınır", async () => {
    const { c, t, channelId } = await setupTicketChannel();
    const { messageId } = await sendMessage(db, c.mgrA, { channelId, body: "selam" });
    const e = await L.waitFor((x): x is Extract<ServerEvent, { kind: "message" }> => isMsg(x) && x.messageId === messageId);
    expect(e).toMatchObject({ channelKind: "ticket", ticketId: t.id, ticketAssigneeId: c.member.id, authorId: c.mgrA.id });
  });

  it("geri alınan transaction olay üretmez", async () => {
    const ghost = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await publishEvent(tx, {
          kind: "message",
          channelId: randomUUID(),
          channelKind: "area",
          areaId: null,
          ticketId: null,
          ticketAssigneeId: null,
          messageId: ghost,
          authorId: null,
        });
        throw new Error("geri al");
      }),
    ).rejects.toThrow("geri al");
    // Sıralama kanıtı: sonradan commit edilen bir olay gelene kadar bekle, sonra hayalet olayın gelmediğini doğrula.
    const sentinel = randomUUID();
    await publishEvent(db, {
      kind: "message",
      channelId: randomUUID(),
      channelKind: "area",
      areaId: null,
      ticketId: null,
      ticketAssigneeId: null,
      messageId: sentinel,
      authorId: null,
    });
    await L.waitFor((x) => isMsg(x) && x.messageId === sentinel);
    expect(L.events.some((x) => isMsg(x) && x.messageId === ghost)).toBe(false);
  });

  it("sendMessage hata verirse (yetki yok) olay yok", async () => {
    const { c, channelId, other } = await setupTicketChannel();
    await sendMessage(db, other, { channelId, body: "x" }).catch(() => {});
    const sentinel = await sendMessage(db, c.mgrA, { channelId, body: "gerçek" });
    await L.waitFor((x) => isMsg(x) && x.messageId === sentinel.messageId);
    expect(L.events.filter(isMsg)).toHaveLength(1);
  });

  it("talep oluşturma (postTicketMessage) de message olayı üretir", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(1000));
    const e = await L.waitFor((x): x is Extract<ServerEvent, { kind: "message" }> => isMsg(x) && x.ticketId === t.id);
    expect(e).toMatchObject({ channelKind: "ticket", authorId: c.member.id, ticketAssigneeId: c.member.id });
  });
});

describe("notification olayı", () => {
  it("az alıcıda kimlik listesi gelir", async () => {
    const [a, b] = await makeManyUsers(2);
    await notify(db, { userIds: [a, b, a], type: "mention", title: "x" });
    const e = await L.waitFor(isNotif);
    expect(e.userIds).not.toBe("all");
    expect([...(e.userIds as string[])].sort()).toEqual([a!, b!].sort());
  });

  it("sınırda (100) kimlik listesi, 101 alıcıda \"all\"", async () => {
    const ids = await makeManyUsers(NOTIFY_FANOUT_LIMIT + 1);
    await notify(db, { userIds: ids.slice(0, NOTIFY_FANOUT_LIMIT), type: "announcement", title: "yüz" });
    const e100 = await L.waitFor(isNotif);
    expect(Array.isArray(e100.userIds)).toBe(true);
    expect((e100.userIds as string[]).length).toBe(NOTIFY_FANOUT_LIMIT);
    L.events.length = 0;
    await notify(db, { userIds: ids, type: "announcement", title: "yüz bir" });
    const e101 = await L.waitFor(isNotif);
    expect(e101.userIds).toBe("all");
  });

  it("yazılacak satır yoksa olay yok", async () => {
    await notify(db, { userIds: [], type: "mention", title: "x" });
    const sentinel = randomUUID();
    await publishEvent(db, {
      kind: "message",
      channelId: randomUUID(),
      channelKind: "area",
      areaId: null,
      ticketId: null,
      ticketAssigneeId: null,
      messageId: sentinel,
      authorId: null,
    });
    await L.waitFor((x) => isMsg(x) && x.messageId === sentinel);
    expect(L.events.some(isNotif)).toBe(false);
  });

  it("duyuru gönderimi hem message hem notification olayı üretir", async () => {
    const c = await setupCycle();
    const { annChannelId } = await import("../helpers/messaging");
    const ann = await annChannelId();
    const { messageId } = await sendMessage(db, c.admin, { channelId: ann, body: "duyuru" });
    await L.waitFor((x) => isMsg(x) && x.messageId === messageId);
    const n = await L.waitFor(isNotif);
    expect(n.userIds).not.toBe("all");
    expect((n.userIds as string[]).sort()).toEqual([c.member.id, c.mgrA.id, c.mgrB.id].sort());
  });
});

describe("hub (subscribeEvents)", () => {
  type HubState = { client: { end: () => Promise<void> } | null; timer: NodeJS.Timeout | null; subs: Set<unknown> };
  afterAll(async () => {
    const h = (globalThis as unknown as { __sector7Hub?: HubState }).__sector7Hub;
    if (h) {
      h.subs.clear();
      if (h.timer) clearTimeout(h.timer);
      await h.client?.end().catch(() => {});
      h.client = null;
    }
  });

  it("abone, mesaj olayını alır; abonelikten çıkınca almaz", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    const got: ServerEvent[] = [];
    const off = subscribeEvents((e) => got.push(e));
    // LISTEN kurulana kadar olay göndererek dene.
    const end = Date.now() + 8000;
    let first: string | null = null;
    while (Date.now() < end && !got.some((e) => e.kind === "message")) {
      const r = await sendMessage(db, c.member, { channelId: ch, body: "ping" });
      first ??= r.messageId;
      await new Promise((r2) => setTimeout(r2, 200));
    }
    expect(got.some((e) => e.kind === "message")).toBe(true);
    off();
    const before = got.length;
    await new Promise((r) => setTimeout(r, 100));
    const { messageId } = await sendMessage(db, c.member, { channelId: ch, body: "sonra" });
    await L.waitFor((x) => isMsg(x) && x.messageId === messageId);
    await new Promise((r) => setTimeout(r, 100));
    expect(got.length).toBe(before);
  });
});
