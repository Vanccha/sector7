"use client";
/**
 * Canlı olaylar istemcisi — SÖZLEŞME (ekranlar kullanır, değiştirmez).
 * Sayfa başına tek EventSource (`/api/olaylar`), abone kalmayınca kapanır. Tarayıcı bağlantı koparsa
 * kendisi yeniden bağlanır; yeniden bağlanınca "ready" olayı gelir — ekranlar kaçırdıklarını yeniden çekmeli.
 */
import { useEffect, useRef } from "react";
import type { ClientEvent } from "@/lib/contracts/realtime";

type Listener = (e: ClientEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

const KINDS: ClientEvent["kind"][] = ["message", "notification", "tickets", "ready"];

function open() {
  if (source || typeof window === "undefined" || typeof EventSource === "undefined") return;
  source = new EventSource("/api/olaylar");
  for (const kind of KINDS) {
    source.addEventListener(kind, (ev) => {
      let data: ClientEvent;
      try {
        data = { ...(JSON.parse((ev as MessageEvent<string>).data || "{}") as object), kind } as ClientEvent;
      } catch {
        return;
      }
      for (const l of listeners) l(data);
    });
  }
}

function close() {
  source?.close();
  source = null;
}

export function subscribeLive(l: Listener): () => void {
  listeners.add(l);
  open();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) close();
  };
}

/** Bileşen yaşadığı sürece canlı olayları dinler. `onEvent` her çizimde değişebilir (ref ile tutulur). */
export function useLiveEvents(onEvent: Listener): void {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  });
  useEffect(() => subscribeLive((e) => ref.current(e)), []);
}
