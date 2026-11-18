/** Aşama 4 (iletişim) test yardımcıları. */
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { db, makeActor, makeArea } from "./db";
import { setupCycle, takenTicket, type Cycle } from "./cycle";
import { channels, messages, notificationPrefs, user } from "../../src/db/schema";
import { loadActor } from "../../src/lib/auth/guards";
import type { Actor } from "../../src/lib/contracts/actor";
import { REALTIME_CHANNEL, type ServerEvent } from "../../src/lib/contracts/realtime";
import { getAnnouncementChannel, getAreaChannel } from "../../src/server/channel-access";
import { getTicketChannelId } from "../../src/server/messaging";

export const annChannelId = async () => (await getAnnouncementChannel(db)).id;

export async function areaChannelId(area: { id: string; name: string }) {
  return (await getAreaChannel(db, area)).id;
}

/** Aktörü veritabanından yeniden yükler (rol / yetki değişikliğinden sonra). */
export async function reload(id: string): Promise<Actor> {
  return (await loadActor(db, id))!;
}

/** Küçük harfli, bilinen kullanıcı adıyla aktör. */
export const makeNamed = (username: string, over: Parameters<typeof makeActor>[0] = {}) =>
  makeActor({ username, displayUsername: username, name: `Ad ${username}`, ...over });

/** `n` mesajı doğrudan ekler; createdAt startAt + i*stepMs (stepMs=0 → veritabanı now(), aynı anda). */
export async function addMessages(
  channelId: string,
  n: number,
  o: { authorId: string | null; startAt?: Date; stepMs?: number; prefix?: string },
) {
  const stepMs = o.stepMs ?? 1000;
  const start = o.startAt ?? new Date(Date.now() - 3_600_000);
  const rows = Array.from({ length: n }, (_, i) => ({
    channelId,
    authorId: o.authorId,
    body: `${o.prefix ?? "m"}${i + 1}`,
    ...(stepMs > 0 ? { createdAt: new Date(start.getTime() + i * stepMs) } : {}),
  }));
  return db.insert(messages).values(rows).returning();
}

export async function messagesOf(channelId: string) {
  return db.select().from(messages).where(eq(messages.channelId, channelId));
}

/** Aktif sprint + alan yöneticileri + ana yönetici + taken bir ticket (üye üzerinde) ve kanalı. */
export async function setupTicketChannel() {
  const c = await setupCycle();
  const t = await takenTicket(c, c.areaA.id, c.member);
  const channelId = await getTicketChannelId(db, c.member, { ticketId: t.id });
  const other = await makeActor({ homeAreaId: c.home.id, name: "İlgisiz" });
  return { c, t, channelId, other };
}
export type { Cycle };

/** Tercih satırı (inApp/push). */
export async function setPref(userId: string, type: string, inApp: boolean, push: boolean) {
  await db
    .insert(notificationPrefs)
    .values({ userId, type, inApp, push })
    .onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.type], set: { inApp, push } });
}

/** Toplu kullanıcı (hızlı) — kimlik listesi döner. */
export async function makeManyUsers(n: number): Promise<string[]> {
  const tag = randomUUID().slice(0, 6);
  const rows = Array.from({ length: n }, (_, i) => ({
    name: `Toplu ${i}`,
    email: `bulk_${tag}_${i}@example.com`,
    username: `bulk_${tag}_${i}`,
    displayUsername: `bulk_${tag}_${i}`,
  }));
  const out = await db.insert(user).values(rows).returning({ id: user.id });
  return out.map((r) => r.id);
}

export async function makeAreaWithName(name: string) {
  return makeArea({ name });
}

export async function channelsOfKind(kind: "area" | "ticket" | "announcement") {
  return db.select().from(channels).where(eq(channels.kind, kind));
}

/** Ayrı bağlantıda `LISTEN sector7_events`; olayları toplar. */
export async function openListener() {
  const c = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await c.connect();
  const events: ServerEvent[] = [];
  c.on("notification", (m) => {
    if (m.channel === REALTIME_CHANNEL && m.payload) events.push(JSON.parse(m.payload) as ServerEvent);
  });
  await c.query(`LISTEN ${REALTIME_CHANNEL}`);
  async function waitFor<T extends ServerEvent>(pred: (e: ServerEvent) => e is T, ms?: number): Promise<T>;
  async function waitFor(pred: (e: ServerEvent) => boolean, ms?: number): Promise<ServerEvent>;
  async function waitFor(pred: (e: ServerEvent) => boolean, ms = 5000): Promise<ServerEvent> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const e = events.find(pred);
      if (e) return e;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`olay gelmedi; gelenler: ${JSON.stringify(events)}`);
  }
  return { events, waitFor, close: () => c.end() };
}
