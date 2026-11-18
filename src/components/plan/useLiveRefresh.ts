"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLiveEvents } from "@/components/realtime/live";

/**
 * Ticket olaylarında ve yeniden bağlanınca sayfayı ~1 sn gecikmeyle (debounce) yeniler.
 * `busy()` true dönerse (ör. kullanıcı sürüklüyor) yenileme ertelenir.
 */
export function useLiveRefresh(busy?: () => boolean, delay = 1000) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  });
  const schedule = useRef<() => void>(() => {});
  useEffect(() => {
    schedule.current = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(function run() {
        if (busyRef.current?.()) {
          timer.current = setTimeout(run, 500);
          return;
        }
        router.refresh();
      }, delay);
    };
  }, [router, delay]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useLiveEvents((e) => {
    if (e.kind === "tickets" || e.kind === "ready") schedule.current();
  });
}
