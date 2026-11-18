"use client";
import { useEffect } from "react";
import { registerSw } from "./registerSw";

/** Üretimde (ya da NEXT_PUBLIC_SW_DEV=1 iken) service worker'ı kaydeder. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW_DEV === "1") {
      void registerSw();
    }
  }, []);
  return null;
}
