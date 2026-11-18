/** Servis katmanının fırlattığı hatalar — SÖZLEŞME. Mesajlar kullanıcıya gösterilebilir (Türkçe). */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "INVALID_STATE";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Bu işlem için giriş yapmalısın.");
export const forbidden = (msg = "Bu işlem için yetkin yok.") => new AppError("FORBIDDEN", msg);
export const notFound = (msg = "Kayıt bulunamadı.") => new AppError("NOT_FOUND", msg);
export const conflict = (msg: string, fields?: Record<string, string>) => new AppError("CONFLICT", msg, fields);
export const invalidState = (msg: string) => new AppError("INVALID_STATE", msg);

/** Server action'ların istemciye döndürdüğü sonuç biçimi. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: AppErrorCode; fields?: Record<string, string> };
