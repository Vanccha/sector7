"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLiveEvents } from "@/components/realtime/live";
import { fetchUnreadMessages, fetchUnreadNotifications } from "./count-actions";

type Counts = { messages: number; notifications: number; setNotifications: (n: number) => void };
const Ctx = createContext<Counts>({ messages: 0, notifications: 0, setNotifications: () => {} });

export function useCounts(): Counts {
  return useContext(Ctx);
}

/** Başlık sayaçları: ilk değerler sunucudan, sonrası canlı olaylarla (1 sn debounce). */
export function LiveCountsProvider({
  userId,
  initialMessages,
  initialNotifications,
  children,
}: {
  userId: string;
  initialMessages: number;
  initialNotifications: number;
  children: React.ReactNode;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [notifications, setNotifications] = useState(initialNotifications);
  const mTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sunucu yeni ilk değer verirse (sayfa yenilenmesi) eşitle.
  const [seen, setSeen] = useState({ m: initialMessages, n: initialNotifications });
  if (seen.m !== initialMessages || seen.n !== initialNotifications) {
    setSeen({ m: initialMessages, n: initialNotifications });
    setMessages(initialMessages);
    setNotifications(initialNotifications);
  }
  useEffect(
    () => () => {
      if (mTimer.current) clearTimeout(mTimer.current);
      if (nTimer.current) clearTimeout(nTimer.current);
    },
    [],
  );

  const refreshMessages = useCallback(() => {
    if (mTimer.current) clearTimeout(mTimer.current);
    mTimer.current = setTimeout(() => {
      fetchUnreadMessages().then(setMessages, () => {});
    }, 1000);
  }, []);
  const refreshNotifications = useCallback(() => {
    if (nTimer.current) clearTimeout(nTimer.current);
    nTimer.current = setTimeout(() => {
      fetchUnreadNotifications().then(setNotifications, () => {});
    }, 1000);
  }, []);

  useLiveEvents((e) => {
    if (e.kind === "ready") {
      refreshMessages();
      refreshNotifications();
    } else if (e.kind === "notification") {
      refreshNotifications();
    } else if (e.kind === "message" && e.authorId !== userId) {
      refreshMessages();
    }
  });

  return <Ctx.Provider value={{ messages, notifications, setNotifications }}>{children}</Ctx.Provider>;
}
