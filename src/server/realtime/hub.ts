/** Süreçte tek LISTEN bağlantısı; olayları abonelere dağıtır. Next.js'e bağımlı değildir. */
import { Client } from "pg";
import { REALTIME_CHANNEL, type ServerEvent } from "@/lib/contracts/realtime";

type Fn = (e: ServerEvent) => void;
type Hub = { subs: Set<Fn>; client: Client | null; connecting: boolean; delay: number; timer: NodeJS.Timeout | null };

const g = globalThis as unknown as { __sector7Hub?: Hub };

function hub(): Hub {
  return (g.__sector7Hub ??= { subs: new Set(), client: null, connecting: false, delay: 1000, timer: null });
}

function schedule(h: Hub) {
  if (h.timer || h.subs.size === 0) return;
  h.timer = setTimeout(() => {
    h.timer = null;
    void connect(h);
  }, h.delay);
  h.timer.unref();
  h.delay = Math.min(h.delay * 2, 30_000);
}

function drop(h: Hub, c: Client) {
  if (h.client === c) h.client = null;
  c.removeAllListeners();
  c.on("error", () => {});
  void c.end().catch(() => {});
  schedule(h);
}

async function connect(h: Hub) {
  if (h.client || h.connecting || h.subs.size === 0) return;
  const url = process.env.DATABASE_URL;
  if (!url) return;
  h.connecting = true;
  const c = new Client({ connectionString: url });
  c.on("error", (e) => {
    console.error("[olaylar] bağlantı hatası:", e.message);
    drop(h, c);
  });
  c.on("end", () => drop(h, c));
  c.on("notification", (m) => {
    if (m.channel !== REALTIME_CHANNEL || !m.payload) return;
    let ev: ServerEvent;
    try {
      ev = JSON.parse(m.payload) as ServerEvent;
    } catch {
      return;
    }
    for (const fn of [...h.subs]) {
      try {
        fn(ev);
      } catch (e) {
        console.error("[olaylar] abone hatası:", e);
      }
    }
  });
  try {
    await c.connect();
    await c.query(`LISTEN ${REALTIME_CHANNEL}`);
    h.client = c;
    h.delay = 1000;
  } catch (e) {
    console.error("[olaylar] LISTEN başarısız:", e instanceof Error ? e.message : e);
    drop(h, c);
  } finally {
    h.connecting = false;
  }
}

export function subscribeEvents(fn: Fn): () => void {
  const h = hub();
  h.subs.add(fn);
  void connect(h);
  return () => {
    h.subs.delete(fn);
  };
}
