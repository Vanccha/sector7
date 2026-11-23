import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { getActor } from "@/lib/auth/session";
import { REMEMBER_COOKIE, peekRememberedDevice } from "@/server/remembered-devices";
import { LoginGate } from "./LoginGate";

export const metadata = { title: "Giriş" };

export default async function LoginPage() {
  if (await getActor()) redirect("/");
  // "Beni hatırla": hesap bilgisi yalnız geçerli cihaz token'ıyla (ad + kullanıcı adı) gösterilir.
  const token = (await cookies()).get(REMEMBER_COOKIE)?.value;
  const remembered = token ? await peekRememberedDevice(db, token) : null;
  return <LoginGate remembered={remembered} />;
}
