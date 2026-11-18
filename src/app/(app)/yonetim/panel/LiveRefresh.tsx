"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLiveEvents } from "@/components/realtime/live";

/** Bildirim / yeniden bağlanma olaylarında paneli (en çok 2 sn'de bir) yeniler. */
export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents((e) => {
    if (e.kind !== "notification" && e.kind !== "ready") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 2000);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return null;
}
