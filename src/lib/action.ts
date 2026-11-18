import { ZodError } from "zod";
import { AppError, type ActionResult } from "@/lib/contracts/errors";

/**
 * Server action gövdesini sarar: AppError ve doğrulama hatalarını istemciye
 * güvenli bir ActionResult olarak döndürür; beklenmeyen hatayı günlüğe yazar.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, code: e.code, fields: e.fields };
    if (e instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of e.issues) {
        const k = issue.path.join(".") || "_";
        if (!fields[k]) fields[k] = issue.message;
      }
      return { ok: false, error: "Formdaki alanları kontrol et.", code: "VALIDATION", fields };
    }
    // Next.js yönlendirme/notFound hatalarını yutma.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { ok: false, error: "Beklenmeyen bir sorun oluştu. Biraz sonra tekrar dene.", code: "INVALID_STATE" };
  }
}
