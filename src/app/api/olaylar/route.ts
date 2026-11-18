import { getActor } from "@/lib/auth/session";
import type { Actor } from "@/lib/contracts/actor";
import type { ClientEvent, ServerEvent } from "@/lib/contracts/realtime";
import { subscribeEvents } from "@/server/realtime/hub";
import { canViewTicket } from "@/server/ticket-common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toClient(actor: Actor, e: ServerEvent): ClientEvent | null {
  if (e.kind === "notification") {
    return e.userIds === "all" || e.userIds.includes(actor.id) ? { kind: "notification" } : null;
  }
  if (e.channelKind === "ticket") {
    if (!e.areaId || !canViewTicket(actor, { areaId: e.areaId, assigneeId: e.ticketAssigneeId })) return null;
  }
  return { kind: "message", channelId: e.channelId, messageId: e.messageId, authorId: e.authorId };
}

function frame(e: ClientEvent): string {
  const { kind, ...rest } = e;
  return `event: ${kind}\ndata: ${JSON.stringify(rest)}\n\n`;
}

export async function GET(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return new Response("Giriş gerekli.", { status: 401 });

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const unsub = subscribeEvents((e) => {
        const out = toClient(actor, e);
        if (out) send(frame(out));
      });
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* zaten kapalı */
        }
      };
      request.signal.addEventListener("abort", cleanup);
      send(frame({ kind: "ready" }));
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
