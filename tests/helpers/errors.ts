import { expect } from "vitest";
import { AppError } from "../../src/lib/contracts/errors";

/** Verilen işlemin belirtilen AppError koduyla reddedildiğini doğrular. */
export async function expectCode(p: Promise<unknown> | (() => Promise<unknown>), code: string) {
  let err: unknown;
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    err = e;
  }
  expect(err, `beklenen hata: ${code}`).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}
