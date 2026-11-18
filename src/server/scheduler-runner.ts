/** Uygulama sürecinde zamanlayıcıyı başlatır (src/instrumentation.ts çağırır). */
import { db } from "@/db";
import { processGithubOutbox } from "./github/outbox";
import { dispatchPendingPush } from "./push";
import { githubSyncEnabled } from "./github/app";
import { subscribeEvents } from "./realtime/hub";
import { runScheduledTick } from "./scheduler";

const INTERVAL_MS = 60_000;
const globalForScheduler = globalThis as unknown as { __sector7Scheduler?: NodeJS.Timeout };

async function tick() {
  try {
    await runScheduledTick(db);
  } catch (e) {
    console.error("[zamanlayıcı] tarama başarısız:", e);
  }
  try {
    await processGithubOutbox(db);
  } catch (e) {
    console.error("[zamanlayıcı] GitHub senkron süpürmesi başarısız:", e);
  }
  try {
    await dispatchPendingPush(db);
  } catch (e) {
    console.error("[zamanlayıcı] push süpürmesi başarısız:", e);
  }
}

export function startScheduler(): void {
  if (process.env.SCHEDULER_DISABLED === "1") return;
  if (globalForScheduler.__sector7Scheduler) return;
  // Yayın/kabul anında gecikme olmasın: `tickets` olayında 2 sn debounce ile kuyruğu işle (SKIP LOCKED güvenli).
  let debounce: NodeJS.Timeout | null = null;
  subscribeEvents((e) => {
    if (e.kind !== "tickets" || !githubSyncEnabled()) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      processGithubOutbox(db).catch((err: unknown) => console.error("[github] kuyruk işlenemedi:", err));
    }, 2000);
    debounce.unref();
  });
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref();
  globalForScheduler.__sector7Scheduler = timer;
  void tick();
}
