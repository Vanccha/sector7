"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { listNotificationsAction, markNotificationsReadAction } from "@/app/(app)/bildirimler/actions";
import { useLiveEvents } from "@/components/realtime/live";
import { fetchUnreadNotifications } from "@/components/shell/count-actions";
import { useCounts } from "@/components/shell/LiveCounts";
import {
  NOTIFICATION_LABELS,
  type NotificationListView,
  type NotificationView,
} from "@/lib/contracts/notifications";

export function relativeTime(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

export function NotificationList({ initial, nowIso }: { initial: NotificationListView; nowIso: string }) {
  const router = useRouter();
  const { setNotifications } = useCounts();
  const [items, setItems] = useState<NotificationView[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(() => Date.parse(nowIso));
  const [pending, start] = useTransition();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useLiveEvents((e) => {
    if (e.kind === "notification") setFresh(true);
  });

  function load(opts: { onlyUnread: boolean; cursor: string | null; append: boolean }) {
    start(async () => {
      const r = await listNotificationsAction({ cursor: opts.cursor, onlyUnread: opts.onlyUnread });
      if (!r.ok) {
        setMsg(r.error);
        return;
      }
      setMsg("");
      setItems((cur) => (opts.append ? [...cur, ...r.data.items] : r.data.items));
      setCursor(r.data.nextCursor);
      setNotifications(r.data.unread);
      if (!opts.append) setFresh(false);
    });
  }

  function toggleFilter(v: boolean) {
    setOnlyUnread(v);
    load({ onlyUnread: v, cursor: null, append: false });
  }

  async function syncCount() {
    setNotifications(await fetchUnreadNotifications());
  }

  function readAll() {
    start(async () => {
      const r = await markNotificationsReadAction({ ids: [] });
      if (!r.ok) {
        setMsg(r.error);
        return;
      }
      const stamp = new Date().toISOString();
      setItems((cur) => (onlyUnread ? [] : cur.map((n) => (n.readAt ? n : { ...n, readAt: stamp }))));
      setNotifications(0);
      setMsg("Hepsi okundu olarak işaretlendi.");
    });
  }

  async function openLink(e: React.MouseEvent, n: NotificationView) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (!n.readAt) await markNotificationsReadAction({ ids: [n.id] });
    void syncCount();
    if (n.link) router.push(n.link);
  }

  async function markOne(id: string) {
    await markNotificationsReadAction({ ids: [id] });
    setItems((cur) => cur.map((x) => (x.id === id ? { ...x, readAt: new Date().toISOString() } : x)));
    void syncCount();
  }

  const unreadHere = items.some((n) => !n.readAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44 }}>
          <input
            type="checkbox"
            checked={onlyUnread}
            onChange={(e) => toggleFilter(e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          Yalnız okunmamışlar
        </label>
        <button type="button" className="btn-line" onClick={readAll} disabled={pending || !unreadHere}>
          Tümünü okundu yap
        </button>
      </div>

      <div aria-live="polite" role="status">
        {msg && (
          <p className="notice" style={{ margin: 0 }}>
            {msg}
          </p>
        )}
      </div>

      {fresh && (
        <button
          type="button"
          className="btn-solid"
          onClick={() => load({ onlyUnread, cursor: null, append: false })}
          disabled={pending}
        >
          Yeni bildirimler — yenile
        </button>
      )}

      {items.length === 0 ? (
        <p className="cut-panel" style={{ padding: 20, margin: 0 }}>
          {onlyUnread ? "Okunmamış bildirimin yok." : "Henüz bildirimin yok. Bir şey olduğunda burada görünecek."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((n) => {
            const unread = !n.readAt;
            const style = {
              minHeight: 44,
              borderLeft: unread ? "3px solid var(--ac-tx)" : undefined,
              opacity: unread ? 1 : 0.8,
            };
            const inner = (
              <>
                <span className="chip-row" style={{ flexWrap: "wrap" }}>
                  <span className="chip-meta">{NOTIFICATION_LABELS[n.type] ?? n.type}</span>
                  {unread && <span className="badge">Yeni</span>}
                  <span className="muted" style={{ fontSize: 13 }}>
                    {relativeTime(n.createdAt, now)}
                  </span>
                </span>
                <span className="chip-title" style={{ fontWeight: unread ? 700 : 500 }}>
                  {n.title}
                </span>
                {n.body && <span style={{ fontSize: 14, overflowWrap: "anywhere" }}>{n.body}</span>}
              </>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <a href={n.link} className="chip" onClick={(e) => openLink(e, n)} style={style}>
                    {inner}
                  </a>
                ) : (
                  <div className="chip" style={style}>
                    {inner}
                    {unread && (
                      <button type="button" className="btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => markOne(n.id)}>
                        Okundu yap
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {cursor && (
        <button type="button" className="btn-line" disabled={pending} onClick={() => load({ onlyUnread, cursor, append: true })}>
          Daha fazla
        </button>
      )}
    </div>
  );
}
