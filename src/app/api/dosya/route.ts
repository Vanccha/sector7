import { ZodError } from "zod";
import { db } from "@/db";
import { getActor } from "@/lib/auth/session";
import { AppError, type AppErrorCode } from "@/lib/contracts/errors";
import { getSettings } from "@/lib/settings";
import { storeUpload } from "@/server/delivery";

export const runtime = "nodejs";

const STATUS: Record<AppErrorCode, number> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  INVALID_STATE: 409,
};

export async function POST(request: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Bu işlem için giriş yapmalısın." }, { status: 401 });
  // Gövdeyi belleğe okumadan önce kaba boyut kontrolü (çok parçalı başlıklar için 64 KB pay).
  const { uploadMaxMb } = await getSettings(db);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > uploadMaxMb * 1024 * 1024 + 64 * 1024) {
    return Response.json({ error: `Dosya en fazla ${uploadMaxMb} MB olabilir.` }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Dosya okunamadı." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Dosya seçilmedi." }, { status: 400 });
  try {
    const ref = await storeUpload(db, actor, file);
    return Response.json(ref, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: STATUS[e.code] ?? 409 });
    if (e instanceof ZodError) return Response.json({ error: "Dosya bilgisi geçersiz." }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Dosya yüklenirken beklenmeyen bir sorun oluştu." }, { status: 500 });
  }
}
