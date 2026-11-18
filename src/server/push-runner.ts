/** Push dağıtıcıyı uygulama sürecinde başlatır (src/instrumentation.ts çağırır). */
import { db } from "@/db";
import { subscribeEvents } from "./realtime/hub";
import { dispatchPendingPush, pushConfig } from "./push";

const g = globalThis as unknown as { __sector7Push?: boolean };

async function run() {
  try {
    await dispatchPendingPush(db);
  } catch (e) {
    console.error("[push] dağıtım başarısız:", e);
  }
}

export function startPushDispatcher(): void {
  if (process.env.PUSH_DISABLED === "1") return;
  if (g.__sector7Push) return;
  g.__sector7Push = true;
  if (!pushConfig()) {
    console.info("[push] VAPID anahtarları tanımlı değil; Web Push kapalı (npm run push:keys).");
    return;
  }
  let timer: NodeJS.Timeout | null = null;
  subscribeEvents((e) => {
    if (e.kind !== "notification") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, 500);
  });
  void run();
}
