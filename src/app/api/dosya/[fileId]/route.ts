import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { db } from "@/db";
import { getActor } from "@/lib/auth/session";
import { AppError, type AppErrorCode } from "@/lib/contracts/errors";
import { readFileForActor } from "@/server/delivery";

export const runtime = "nodejs";

const STATUS: Record<AppErrorCode, number> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  INVALID_STATE: 409,
};

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!z.uuid().safeParse(fileId).success) return Response.json({ error: "Dosya bulunamadı." }, { status: 404 });
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Bu işlem için giriş yapmalısın." }, { status: 401 });
  try {
    const f = await readFileForActor(db, actor, fileId);
    const stream = Readable.toWeb(createReadStream(f.absolutePath)) as unknown as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": f.mimeType || "application/octet-stream",
        "Content-Length": String(f.sizeBytes),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: STATUS[e.code] ?? 409 });
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT") {
      return Response.json({ error: "Dosya bulunamadı." }, { status: 404 });
    }
    console.error(e);
    return Response.json({ error: "Dosya okunurken beklenmeyen bir sorun oluştu." }, { status: 500 });
  }
}
