import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import type { Actor } from "@/lib/contracts/actor";
import { auth } from "./auth";
import { loadActor } from "./guards";

/** Geçerli isteğin aktörü (istek başına bir kez yüklenir). Oturum yoksa null. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  return loadActor(db, s.user.id);
});

/** Sayfalar için: oturum yoksa giriş sayfasına yönlendirir. */
export async function requirePageActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/giris");
  return a;
}

/** Sayfalar için: ana yönetici değilse ana sayfaya yönlendirir. */
export async function requirePageMainAdmin(): Promise<Actor> {
  const a = await requirePageActor();
  if (!a.isMainAdmin) redirect("/");
  return a;
}
