"use server";
import { db } from "@/db";
import { runAction } from "@/lib/action";
import { setPasswordSchema } from "@/lib/contracts/applications";
import type { ActionResult } from "@/lib/contracts/errors";
import { consumePasswordToken } from "@/server/accounts";

/** Tek kullanımlık bağlantıyla şifre belirleme. Başarılıysa kişi giriş sayfasına yönlendirilmeli. */
export async function setPasswordAction(input: {
  token: string;
  password: string;
  passwordRepeat: string;
}): Promise<ActionResult<{ username: string }>> {
  return runAction(async () => {
    const v = setPasswordSchema.parse(input);
    const r = await consumePasswordToken(db, v.token, v.password);
    return { username: r.username };
  });
}
