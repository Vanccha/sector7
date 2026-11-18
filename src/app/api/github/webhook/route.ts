import { db } from "@/db";
import { handleGithubEvent, verifyGithubSignature } from "@/server/github/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1024 * 1024;

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 404 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return Response.json({ error: "Gövde çok büyük." }, { status: 413 });
  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: "Gövde çok büyük." }, { status: 413 });

  if (!verifyGithubSignature(buf, request.headers.get("x-hub-signature-256"), secret)) {
    return Response.json({ error: "İmza geçersiz." }, { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  if (!event || !deliveryId) return Response.json({ error: "Başlıklar eksik." }, { status: 400 });

  let payload: unknown;
  try {
    payload = JSON.parse(buf.toString("utf8"));
  } catch {
    return Response.json({ error: "Gövde JSON değil." }, { status: 400 });
  }
  try {
    const r = await handleGithubEvent(db, { event, deliveryId, payload });
    return Response.json({ status: r.status });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "İşlenemedi." }, { status: 500 });
  }
}
