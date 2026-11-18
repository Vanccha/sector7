export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./server/scheduler-runner");
    startScheduler();
    const { startPushDispatcher } = await import("./server/push-runner");
    startPushDispatcher();
  }
}
