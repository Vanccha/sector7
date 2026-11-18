import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { areas, channels, ticketRequests, tickets } from "../../src/db/schema";
import { getAnnouncementChannel } from "../../src/server/channel-access";
import { setCanAnnounce } from "../../src/server/announce-access";
import {
  getChannelView,
  getTicketChannelId,
  listChannels,
  listNewerMessages,
  listOlderMessages,
  markChannelRead,
  sendMessage,
  unreadMessageCount,
} from "../../src/server/messaging";
import { createRequest } from "../../src/server/ticket-requests";
import { db, makeActor, makeMainAdmin, makeUser, resetDb } from "../helpers/db";
import { H, allNotifs, at, expectValidation, makeMember, notifsOf, setupCycle, takenTicket } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { auditRows } from "../helpers/plan";
import {
  addMessages,
  annChannelId,
  areaChannelId,
  makeNamed,
  messagesOf,
  reload,
  setupTicketChannel,
} from "../helpers/messaging";

beforeEach(resetDb);

describe("kanal erişimi: alan ve duyuru", () => {
  it("alan ve duyuru kanalını herkes okur; alan kanalına herkes yazar", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaB);
    const ann = await annChannelId();
    for (const who of [c.member, c.mgrA, c.admin]) {
      expect((await getChannelView(db, who, { channelId: ch })).channel.kind).toBe("area");
      expect((await getChannelView(db, who, { channelId: ann })).channel.kind).toBe("announcement");
    }
    const { messageId } = await sendMessage(db, c.member, { channelId: ch, body: "selam" });
    const v = await getChannelView(db, c.mgrA, { channelId: ch });
    expect(v.canWrite).toBe(true);
    expect(v.messages.map((m) => m.id)).toEqual([messageId]);
  });

  it("arşivli alan kanalına yazma FORBIDDEN (ana yönetici dahil), okuma serbest", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaB);
    await db.update(areas).set({ archivedAt: new Date() }).where(eq(areas.id, c.areaB.id));
    await expectCode(sendMessage(db, c.member, { channelId: ch, body: "x" }), "FORBIDDEN");
    await expectCode(sendMessage(db, c.admin, { channelId: ch, body: "x" }), "FORBIDDEN");
    const v = await getChannelView(db, c.member, { channelId: ch });
    expect(v.canWrite).toBe(false);
    expect(v.writeHint).toBeTruthy();
    expect(v.channel.archived).toBe(true);
  });

  it("duyuruya yalnız ana yönetici ve canAnnounce yazar", async () => {
    const c = await setupCycle();
    const ann = await annChannelId();
    await expectCode(sendMessage(db, c.member, { channelId: ann, body: "x" }), "FORBIDDEN");
    await expectCode(sendMessage(db, c.mgrA, { channelId: ann, body: "x" }), "FORBIDDEN");
    const granted = await makeActor({ canAnnounce: true });
    await sendMessage(db, granted, { channelId: ann, body: "izinli" });
    await sendMessage(db, c.admin, { channelId: ann, body: "ana" });
    expect(await messagesOf(ann)).toHaveLength(2);
    expect((await getChannelView(db, c.member, { channelId: ann })).canWrite).toBe(false);
  });
});

describe("kanal erişimi: ticket", () => {
  it("ticket kişisi, alan yöneticisi ve ana yönetici okur/yazar", async () => {
    const { c, channelId } = await setupTicketChannel();
    for (const who of [c.member, c.mgrA, c.admin]) {
      const v = await getChannelView(db, who, { channelId });
      expect(v.canWrite).toBe(true);
      await sendMessage(db, who, { channelId, body: `merhaba ${who.name}` });
      await markChannelRead(db, who, { channelId });
    }
    expect(await messagesOf(channelId)).toHaveLength(3);
  });

  it("ilgisiz üye ve başka alanın yöneticisi: tüm işlemlerde NOT_FOUND", async () => {
    const { c, channelId, other } = await setupTicketChannel();
    await addMessages(channelId, 2, { authorId: c.member.id });
    const rnd = randomUUID();
    for (const who of [other, c.mgrB]) {
      await expectCode(getChannelView(db, who, { channelId }), "NOT_FOUND");
      await expectCode(sendMessage(db, who, { channelId, body: "sızma" }), "NOT_FOUND");
      await expectCode(listOlderMessages(db, who, { channelId, beforeId: rnd }), "NOT_FOUND");
      await expectCode(listNewerMessages(db, who, { channelId, afterId: null }), "NOT_FOUND");
      await expectCode(markChannelRead(db, who, { channelId }), "NOT_FOUND");
    }
    expect(await messagesOf(channelId)).toHaveLength(2);
  });

  it("ticket'tan geri çekilen eski kişi artık okuyamaz", async () => {
    const { c, t, channelId } = await setupTicketChannel();
    await getChannelView(db, c.member, { channelId });
    await db.update(tickets).set({ status: "available", assigneeId: null }).where(eq(tickets.id, t.id));
    const old = await reload(c.member.id);
    await expectCode(getChannelView(db, old, { channelId }), "NOT_FOUND");
    await expectCode(sendMessage(db, old, { channelId, body: "x" }), "NOT_FOUND");
  });

  it("getTicketChannelId: yoksa açar, ikinci çağrıda aynı id; ilgisize NOT_FOUND", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member);
    expect(await db.select().from(channels).where(eq(channels.ticketId, t.id))).toHaveLength(0);
    const id1 = await getTicketChannelId(db, c.member, { ticketId: t.id });
    const id2 = await getTicketChannelId(db, c.mgrA, { ticketId: t.id });
    expect(id2).toBe(id1);
    expect(await db.select().from(channels).where(eq(channels.ticketId, t.id))).toHaveLength(1);
    const other = await makeMember(c.home.id);
    await expectCode(getTicketChannelId(db, other, { ticketId: t.id }), "NOT_FOUND");
    await expectCode(getTicketChannelId(db, c.mgrB, { ticketId: t.id }), "NOT_FOUND");
  });
});

describe("sendMessage: bildirimler", () => {
  it("alan kanalında sıradan mesaj bildirim üretmez", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    await sendMessage(db, c.member, { channelId: ch, body: "herkese selam" });
    expect(await allNotifs()).toHaveLength(0);
  });

  it("@kullanıcı yalnız o kişiye mention; yazan kendinden bahsederse, var olmayan ad ve pasif kullanıcıya yok", async () => {
    const c = await setupCycle();
    const ali = await makeNamed("ali_test");
    await makeNamed("veli_test");
    await makeUser({ username: "pasif_kisi", active: false });
    const me = await makeNamed("yazar_kisi");
    const ch = await areaChannelId(c.areaA);
    await sendMessage(db, me, { channelId: ch, body: "bak @ali_test, @yazar_kisi @yok_boyle_biri @pasif_kisi" });
    const all = await allNotifs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ userId: ali.id, type: "mention" });
    expect(all[0]!.link).toContain(ch);
  });

  it("cümle sonu noktalı @ad da bulunur", async () => {
    const c = await setupCycle();
    const ali = await makeNamed("ali_test");
    const ch = await areaChannelId(c.areaA);
    await sendMessage(db, c.member, { channelId: ch, body: "teşekkürler @ali_test." });
    expect((await allNotifs("mention")).map((n) => n.userId)).toEqual([ali.id]);
  });

  it("e-posta benzeri metin bahsetme sayılmaz", async () => {
    const c = await setupCycle();
    await makeNamed("ali_test");
    const ch = await areaChannelId(c.areaA);
    await sendMessage(db, c.member, { channelId: ch, body: "yaz ali_test@ornek.com adresine" });
    expect(await allNotifs()).toHaveLength(0);
  });

  it("duyuru: yazan hariç tüm aktif kullanıcılara announcement; bahsedilene ayrıca mention yok", async () => {
    const c = await setupCycle();
    const ali = await makeNamed("ali_test");
    const pasif = await makeUser({ username: "pasif_kisi", active: false });
    const ann = await annChannelId();
    await sendMessage(db, c.admin, { channelId: ann, body: "Toplantı var @ali_test" });
    const anns = await allNotifs("announcement");
    const recips = anns.map((n) => n.userId).sort();
    const expected = [c.member.id, c.mgrA.id, c.mgrB.id, ali.id].sort();
    expect(recips).toEqual(expected);
    expect(recips).not.toContain(c.admin.id);
    expect(recips).not.toContain(pasif.id);
    expect(await allNotifs("mention")).toHaveLength(0);
    expect(await notifsOf(ali.id)).toHaveLength(1);
  });

  it("ticket kanalı: kişi + alan yöneticisi (yazan hariç) ticket_message; ana yönetici (yönetici varken) almaz", async () => {
    const { c, channelId } = await setupTicketChannel();
    await sendMessage(db, c.member, { channelId, body: "bir sorum var" });
    expect(await notifsOf(c.mgrA.id, "ticket_message")).toHaveLength(1);
    expect(await notifsOf(c.member.id)).toHaveLength(0);
    expect(await notifsOf(c.admin.id)).toHaveLength(0);
    await sendMessage(db, c.mgrA, { channelId, body: "cevap" });
    expect(await notifsOf(c.member.id, "ticket_message")).toHaveLength(1);
    expect(await notifsOf(c.mgrA.id, "ticket_message")).toHaveLength(1);
  });

  it("ticket kanalı: katılımcı olmayan ama okuyabilen bahsedilen (ana yönetici) mention alır", async () => {
    const { c, channelId } = await setupTicketChannel();
    const boss = await makeMainAdmin({ username: "boss_kisi" });
    await sendMessage(db, c.member, { channelId, body: "bakar mısın @boss_kisi" });
    const n = await notifsOf(boss.id);
    expect(n).toHaveLength(1);
    expect(n[0]!.type).toBe("mention");
  });

  it("ticket kanalı: kişi başına tek bildirim (katılımcı bahsedilse de, iki kez bahsedilse de)", async () => {
    const { c, channelId } = await setupTicketChannel();
    const mgr = await makeNamed("mgr_kisi");
    await db.update(areas).set({ managerId: mgr.id }).where(eq(areas.id, c.areaA.id));
    const boss = await makeMainAdmin({ username: "boss_kisi" });
    await sendMessage(db, c.member, { channelId, body: "@mgr_kisi @mgr_kisi @boss_kisi @boss_kisi" });
    const forMgr = await notifsOf(mgr.id);
    expect(forMgr).toHaveLength(1);
    expect(forMgr[0]!.type).toBe("ticket_message");
    expect(await notifsOf(boss.id)).toHaveLength(1);
  });

  it("ticket'ı göremeyen bahsedilen için bildirim yok", async () => {
    const { c, channelId } = await setupTicketChannel();
    await makeNamed("gorunmez_kisi");
    await sendMessage(db, c.member, { channelId, body: "@gorunmez_kisi" });
    expect(await allNotifs("mention")).toHaveLength(0);
  });

  it("her gönderim message.send denetim kaydı üretir", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    const { messageId } = await sendMessage(db, c.member, { channelId: ch, body: "kayıt" });
    const rows = await auditRows("message.send", messageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(c.member.id);
    const ann = await annChannelId();
    const r2 = await sendMessage(db, c.admin, { channelId: ann, body: "duyuru" });
    expect(await auditRows("message.send", r2.messageId)).toHaveLength(1);
    expect(await auditRows("message.send")).toHaveLength(2);
  });

  it("4000 karakter geçerli; 4001 ve boş / yalnız boşluk doğrulama hatası", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    await sendMessage(db, c.member, { channelId: ch, body: "a".repeat(4000) });
    await expectValidation(sendMessage(db, c.member, { channelId: ch, body: "a".repeat(4001) }));
    await expectValidation(sendMessage(db, c.member, { channelId: ch, body: "" }));
    await expectValidation(sendMessage(db, c.member, { channelId: ch, body: "   \n " }));
    expect(await messagesOf(ch)).toHaveLength(1);
  });
});

describe("talep bağlama", () => {
  async function withRequest() {
    const s = await setupTicketChannel();
    const { id } = await createRequest(
      db,
      s.c.member,
      { ticketId: s.t.id, kind: "extension", reason: "Daha çok zaman lazım" },
      at(1000),
    );
    return { ...s, requestId: id };
  }
  const req = async (id: string) => (await db.select().from(ticketRequests).where(eq(ticketRequests.id, id)))[0]!;

  it("bekleyen talep varken yöneticinin mesajı requestId ile bağlanır, awaitingRequesterAt dolar", async () => {
    const { c, channelId, requestId } = await withRequest();
    const now = at(2 * H);
    const { messageId } = await sendMessage(db, c.mgrA, { channelId, body: "Neden lazım?" }, now);
    const m = (await messagesOf(channelId)).find((x) => x.id === messageId)!;
    expect(m.requestId).toBe(requestId);
    expect((await req(requestId)).awaitingRequesterAt).toEqual(now);
    const v = await getChannelView(db, c.mgrA, { channelId });
    expect(v.pendingRequest).toMatchObject({ id: requestId, kind: "extension" });
  });

  it("talep sahibinin cevabı awaitingRequesterAt'ı temizler ve mesaj talebe bağlanır", async () => {
    const { c, channelId, requestId } = await withRequest();
    await sendMessage(db, c.mgrA, { channelId, body: "Neden lazım?" }, at(2 * H));
    expect((await req(requestId)).awaitingRequesterAt).not.toBeNull();
    const { messageId } = await sendMessage(db, c.member, { channelId, body: "Çünkü şu" }, at(3 * H));
    const m = (await messagesOf(channelId)).find((x) => x.id === messageId)!;
    expect(m.requestId).toBe(requestId);
    expect((await req(requestId)).awaitingRequesterAt).toBeNull();
  });

  it("talep yokken mesajın requestId'si null", async () => {
    const { c, channelId } = await setupTicketChannel();
    const { messageId } = await sendMessage(db, c.mgrA, { channelId, body: "sıradan" });
    expect((await messagesOf(channelId)).find((x) => x.id === messageId)!.requestId).toBeNull();
    expect((await getChannelView(db, c.mgrA, { channelId })).pendingRequest).toBeNull();
  });
});

describe("okunmamış sayısı", () => {
  it("yeni kullanıcı için hesap açılışından önceki mesajlar okunmamış sayılmaz", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    await addMessages(ch, 5, { authorId: c.member.id, startAt: new Date(Date.now() - 86_400_000) });
    const fresh = await makeActor();
    expect(await unreadMessageCount(db, fresh)).toBe(0);
    expect((await listChannels(db, fresh)).totalUnread).toBe(0);
  });

  it("başkasının mesajı +1, kendi mesajı 0; markChannelRead sonrası 0", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    await sendMessage(db, c.member, { channelId: ch, body: "kendi" });
    expect(await unreadMessageCount(db, c.member)).toBe(0);
    expect(await unreadMessageCount(db, c.mgrA)).toBe(1);
    await sendMessage(db, c.admin, { channelId: ch, body: "ikinci" });
    expect(await unreadMessageCount(db, c.mgrA)).toBe(2);
    expect(await unreadMessageCount(db, c.member)).toBe(1);
    await markChannelRead(db, c.mgrA, { channelId: ch }, new Date(Date.now() + 5000));
    expect(await unreadMessageCount(db, c.mgrA)).toBe(0);
    expect((await getChannelView(db, c.mgrA, { channelId: ch })).channel.unread).toBe(0);
  });

  it("listChannels.totalUnread = unreadMessageCount ve kanal toplamı", async () => {
    const { c, channelId } = await setupTicketChannel();
    const area = await areaChannelId(c.areaB);
    const ann = await annChannelId();
    await sendMessage(db, c.admin, { channelId: ann, body: "duyuru" });
    await sendMessage(db, c.member, { channelId: area, body: "alan" });
    await sendMessage(db, c.mgrA, { channelId, body: "ticket" });
    const list = await listChannels(db, c.member);
    expect(list.totalUnread).toBe(await unreadMessageCount(db, c.member));
    expect(list.totalUnread).toBe(
      list.announcement.unread + list.areas.reduce((n, a) => n + a.unread, 0) + list.tickets.reduce((n, a) => n + a.unread, 0),
    );
    expect(list.announcement.unread).toBe(1);
    expect(list.areas.find((a) => a.id === area)!.unread).toBe(0); // kendi mesajı
    expect(list.tickets.find((a) => a.id === channelId)!.unread).toBe(1);
    expect(list.totalUnread).toBe(2);
  });

  it("ticket kanalları listede yalnız mesajı varsa ve görebiliyorsa", async () => {
    const { c, channelId, other } = await setupTicketChannel();
    for (const who of [c.member, c.mgrA, c.admin]) expect((await listChannels(db, who)).tickets).toHaveLength(0);
    await sendMessage(db, c.member, { channelId, body: "merhaba" });
    for (const who of [c.member, c.mgrA, c.admin]) {
      const l = await listChannels(db, who);
      expect(l.tickets.map((t) => t.id)).toEqual([channelId]);
    }
    expect((await listChannels(db, other)).tickets).toHaveLength(0);
    expect((await listChannels(db, c.mgrB)).tickets).toHaveLength(0);
  });
});

describe("sayfalama", () => {
  it("120 mesajda getChannelView son 50 (eskiden yeniye) + hasOlder", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    await addMessages(ch, 120, { authorId: c.member.id });
    const v = await getChannelView(db, c.mgrA, { channelId: ch });
    expect(v.messages).toHaveLength(50);
    expect(v.messages.map((m) => m.body)).toEqual(Array.from({ length: 50 }, (_, i) => `m${71 + i}`));
    expect(v.hasOlder).toBe(true);
  });

  it("50 mesajda hasOlder false", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    await addMessages(ch, 50, { authorId: c.member.id });
    const v = await getChannelView(db, c.mgrA, { channelId: ch });
    expect(v.messages).toHaveLength(50);
    expect(v.hasOlder).toBe(false);
  });

  it("listOlderMessages ardışık sayfalar çakışmasız ve eksiksiz", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    await addMessages(ch, 120, { authorId: c.member.id });
    const v = await getChannelView(db, c.mgrA, { channelId: ch });
    const p2 = await listOlderMessages(db, c.mgrA, { channelId: ch, beforeId: v.messages[0]!.id });
    expect(p2.messages).toHaveLength(50);
    expect(p2.hasOlder).toBe(true);
    const p3 = await listOlderMessages(db, c.mgrA, { channelId: ch, beforeId: p2.messages[0]!.id });
    expect(p3.messages).toHaveLength(20);
    expect(p3.hasOlder).toBe(false);
    const all = [...p3.messages, ...p2.messages, ...v.messages].map((m) => m.body);
    expect(all).toEqual(Array.from({ length: 120 }, (_, i) => `m${i + 1}`));
  });

  it("aynı createdAt'e sahip mesajlarda (tek ifadede eklenmiş) çakışma ve eksik yok", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    const inserted = await addMessages(ch, 120, { authorId: c.member.id, stepMs: 0 });
    expect(new Set(inserted.map((r) => r.createdAt.getTime())).size).toBe(1);
    const v = await getChannelView(db, c.mgrA, { channelId: ch });
    const seen = [...v.messages.map((m) => m.id)];
    let cursor = v.messages[0]!.id;
    let hasOlder = v.hasOlder;
    while (hasOlder) {
      const p = await listOlderMessages(db, c.mgrA, { channelId: ch, beforeId: cursor });
      seen.unshift(...p.messages.map((m) => m.id));
      cursor = p.messages[0]!.id;
      hasOlder = p.hasOlder;
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(new Set(seen)).toEqual(new Set(inserted.map((r) => r.id)));
  });

  it("listNewerMessages afterId sonrasını döndürür", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    const rows = await addMessages(ch, 10, { authorId: c.member.id });
    const after = await listNewerMessages(db, c.mgrA, { channelId: ch, afterId: rows[6]!.id });
    expect(after.map((m) => m.body)).toEqual(["m8", "m9", "m10"]);
    expect(await listNewerMessages(db, c.mgrA, { channelId: ch, afterId: rows[9]!.id })).toEqual([]);
    const last = await listNewerMessages(db, c.mgrA, { channelId: ch, afterId: null });
    expect(last).toHaveLength(10);
  });

  it("başka kanalın mesaj kimliği imleç olarak NOT_FOUND", async () => {
    const c = await setupCycle();
    const ch = await areaChannelId(c.areaA);
    const ch2 = await areaChannelId(c.areaB);
    const [m] = await addMessages(ch2, 1, { authorId: c.member.id });
    await expectCode(listOlderMessages(db, c.mgrA, { channelId: ch, beforeId: m!.id }), "NOT_FOUND");
    await expectCode(listNewerMessages(db, c.mgrA, { channelId: ch, afterId: m!.id }), "NOT_FOUND");
  });
});

describe("duyuru yetkisi", () => {
  it("setCanAnnounce yalnız ana yönetici; diğerleri FORBIDDEN", async () => {
    const c = await setupCycle();
    const target = await makeUser();
    await expectCode(setCanAnnounce(db, c.member, { userId: target.id, value: true }), "FORBIDDEN");
    await expectCode(setCanAnnounce(db, c.mgrA, { userId: target.id, value: true }), "FORBIDDEN");
    await setCanAnnounce(db, c.admin, { userId: target.id, value: true });
  });

  it("verince duyuruya yazar, alınca yazamaz; audit grant/revoke", async () => {
    const c = await setupCycle();
    const ann = (await getAnnouncementChannel(db)).id;
    const target = await makeActor();
    await expectCode(sendMessage(db, target, { channelId: ann, body: "x" }), "FORBIDDEN");
    await setCanAnnounce(db, c.admin, { userId: target.id, value: true });
    expect(await auditRows("user.grant_announce", target.id)).toHaveLength(1);
    await sendMessage(db, await reload(target.id), { channelId: ann, body: "artık yazabilirim" });
    await setCanAnnounce(db, c.admin, { userId: target.id, value: false });
    expect(await auditRows("user.revoke_announce", target.id)).toHaveLength(1);
    await expectCode(sendMessage(db, await reload(target.id), { channelId: ann, body: "yazamam" }), "FORBIDDEN");
  });

  it("değişmeyen değerde ek audit yazılmaz", async () => {
    const c = await setupCycle();
    const target = await makeUser();
    await setCanAnnounce(db, c.admin, { userId: target.id, value: true });
    await setCanAnnounce(db, c.admin, { userId: target.id, value: true });
    expect(await auditRows("user.grant_announce")).toHaveLength(1);
  });
});
