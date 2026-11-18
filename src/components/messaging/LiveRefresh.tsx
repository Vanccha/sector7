"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLiveEvents } from "@/components/realtime/live";

/** Mesaj olaylarında sunucu verisini (en fazla saniyede bir) yeniler. */
export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents((e) => {
    if (e.kind !== "message" && e.kind !== "ready") return;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, 1000);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return null;
}
