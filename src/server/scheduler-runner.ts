/** Uygulama sürecinde zamanlayıcıyı başlatır (src/instrumentation.ts çağırır). */
import { db } from "@/db";
import { runScheduledTick } from "./scheduler";

const INTERVAL_MS = 60_000;
const globalForScheduler = globalThis as unknown as { __sector7Scheduler?: NodeJS.Timeout };

async function tick() {
  try {
    await runScheduledTick(db);
  } catch (e) {
    console.error("[zamanlayıcı] tarama başarısız:", e);
  }
}

export function startScheduler(): void {
  if (process.env.SCHEDULER_DISABLED === "1") return;
  if (globalForScheduler.__sector7Scheduler) return;
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref();
  globalForScheduler.__sector7Scheduler = timer;
  void tick();
}
