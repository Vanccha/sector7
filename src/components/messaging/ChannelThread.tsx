"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useLiveEvents } from "@/components/realtime/live";
import { MESSAGE_MAX, type ChannelView, type MessageView, type SendResult } from "@/lib/contracts/messaging";
import type { ActionResult } from "@/lib/contracts/errors";
import {
  listNewerMessagesAction,
  listOlderMessagesAction,
  markChannelReadAction,
  sendMessageAction,
  sendTicketMessageAction,
} from "@/app/(app)/mesajlar/actions";
import styles from "./ChannelThread.module.css";

const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" });
const REQ_TAG = { extension: "Ek süre talebi", withdrawal: "Geri çekme talebi" } as const;
const REQ_PLAIN = { extension: "ek süre", withdrawal: "geri çekme" } as const;

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date();
  y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return "Bugün";
  if (dayKey(d) === dayKey(y)) return "Dün";
  return dayFmt.format(d);
}

function renderBody(body: string, usernames: Set<string>): ReactNode[] {
  const re = /(https?:\/\/[^\s<]+)|(^|[^a-z0-9_.@])@([a-z0-9_.]{3,30})/gi;
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1]) {
      let url = m[1];
      const trail = url.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
      if (trail) url = url.slice(0, -trail.length);
      out.push(body.slice(last, m.index));
      out.push(
        <a key={k++} href={url} rel="noopener noreferrer" target="_blank">
          {url}
        </a>,
      );
      last = m.index + url.length;
      re.lastIndex = last;
    } else {
      const raw = (m[3] ?? "").toLowerCase();
      const trimmed = raw.replace(/\.+$/, "");
      const name = usernames.has(raw) ? raw : usernames.has(trimmed) ? trimmed : null;
      if (!name) continue;
      const start = m.index + (m[2]?.length ?? 0);
      out.push(body.slice(last, start));
      out.push(
        <span key={k++} className={styles.mention}>
          {body.slice(start, start + 1 + name.length)}
        </span>,
      );
      last = start + 1 + name.length;
      re.lastIndex = last;
    }
  }
  out.push(body.slice(last));
  return out;
}

function mergeNew(list: MessageView[], add: MessageView[]): MessageView[] {
  const seen = new Set(list.map((m) => m.id));
  const fresh = add.filter((m) => !seen.has(m.id));
  return fresh.length ? [...list, ...fresh] : list;
}

export function ChannelThread({
  view,
  ticketChannel = false,
  fill = false,
}: {
  view: ChannelView;
  /** Ticket konuşması: gönderim ticket sayfasını da tazeler. */
  ticketChannel?: boolean;
  /** Üst kapsayıcının yüksekliğini doldur (tam sayfa sohbet); aksi hâlde sınırlı yükseklik. */
  fill?: boolean;
}) {
  const channelId = view.channel.id;
  const [msgs, setMsgs] = useState<MessageView[]>(view.messages);
  const [hasOlder, setHasOlder] = useState(view.hasOlder);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, startSend] = useTransition();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [sugg, setSugg] = useState<{ start: number; q: string } | null>(null);
  const [suggIdx, setSuggIdx] = useState(0);
  const logRef = useRef<HTMLUListElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const lastId = useRef<string | null>(view.messages.at(-1)?.id ?? null);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetching = useRef(false);

  useEffect(() => {
    lastId.current = msgs.at(-1)?.id ?? null;
  }, [msgs]);

  const usernames = useMemo(() => new Set(view.mentionables.map((u) => u.username.toLowerCase())), [view.mentionables]);

  const markRead = useCallback(() => {
    if (readTimer.current) return;
    readTimer.current = setTimeout(() => {
      readTimer.current = null;
      if (atBottom.current && document.visibilityState === "visible") void markChannelReadAction({ channelId });
    }, 2000);
  }, [channelId]);

  useEffect(
    () => () => {
      if (readTimer.current) clearTimeout(readTimer.current);
    },
    [],
  );

  const scrollBottom = useCallback(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollBottom();
    markRead();
  }, [scrollBottom, markRead]);

  const fetchNewer = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await listNewerMessagesAction({ channelId, afterId: lastId.current });
      if (res.ok && res.data.length > 0) {
        setMsgs((cur) => mergeNew(cur, res.data));
        if (atBottom.current) {
          requestAnimationFrame(scrollBottom);
          markRead();
        } else setUnseen(true);
      }
    } finally {
      fetching.current = false;
    }
  }, [channelId, markRead, scrollBottom]);

  useLiveEvents((e) => {
    if (e.kind === "ready" || (e.kind === "message" && e.channelId === channelId)) void fetchNewer();
  });

  function onScroll() {
    const el = logRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    atBottom.current = near;
    if (near) {
      setUnseen(false);
      markRead();
    }
  }

  async function loadOlder() {
    const first = msgs[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const el = logRef.current;
    const prevH = el?.scrollHeight ?? 0;
    const res = await listOlderMessagesAction({ channelId, beforeId: first.id });
    setLoadingOlder(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMsgs((cur) => [...res.data.messages.filter((m) => !cur.some((c) => c.id === m.id)), ...cur]);
    setHasOlder(res.data.hasOlder);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevH;
    });
  }

  function submit() {
    const text = body.trim();
    if (!text || sending) return;
    setError(null);
    const send: (i: { channelId: string; body: string }) => Promise<ActionResult<SendResult>> = ticketChannel
      ? sendTicketMessageAction
      : sendMessageAction;
    startSend(async () => {
      const res = await send({ channelId, body: text });
      if (!res.ok) {
        setError(res.fields?.body ?? res.error);
        return;
      }
      setBody("");
      setSugg(null);
      atBottom.current = true;
      await fetchNewer();
      requestAnimationFrame(scrollBottom);
      taRef.current?.focus();
    });
  }

  const matches = useMemo(() => {
    if (!sugg) return [];
    const q = sugg.q.toLowerCase();
    return view.mentionables
      .filter((u) => u.username.toLowerCase().startsWith(q) || u.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [sugg, view.mentionables]);

  function detectMention(value: string, caret: number) {
    const m = value.slice(0, caret).match(/(^|[^a-z0-9_.@])@([a-z0-9_.]{0,30})$/i);
    if (m) {
      setSugg({ start: caret - (m[2]?.length ?? 0) - 1, q: m[2] ?? "" });
      setSuggIdx(0);
    } else setSugg(null);
  }

  function pick(username: string) {
    if (!sugg) return;
    const caret = taRef.current?.selectionStart ?? body.length;
    setBody(`${body.slice(0, sugg.start)}@${username} ${body.slice(caret)}`);
    setSugg(null);
    const pos = sugg.start + username.length + 2;
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (sugg && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggIdx((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggIdx((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[suggIdx]!.username);
        return;
      }
      if (e.key === "Escape") {
        setSugg(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const dayStarts = new Set<string>();
  {
    let prev = "";
    for (const m of msgs) {
      const dk = dayKey(new Date(m.createdAt));
      if (dk !== prev) dayStarts.add(m.id);
      prev = dk;
    }
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.logWrap}>
        <ul
          ref={logRef}
          className={`${styles.log} ${fill ? "" : styles.capped}`}
          role="log"
          aria-live="polite"
          aria-label="Mesajlar"
          onScroll={onScroll}
          tabIndex={0}
        >
          {hasOlder ? (
            <li style={{ alignSelf: "center" }}>
              <button type="button" className={`btn-ghost ${styles.more}`} onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? "Yükleniyor…" : "Daha eski mesajlar"}
              </button>
            </li>
          ) : null}
          {msgs.length === 0 ? (
            <li className={styles.hint} style={{ alignSelf: "center" }}>
              Henüz mesaj yok.
            </li>
          ) : null}
          {msgs.map((m) => {
            const sep = dayStarts.has(m.id);
            const isSys = m.kind === "system";
            const reqKind = m.requestId && view.pendingRequest?.id === m.requestId ? view.pendingRequest.kind : null;
            return (
              <Fragment key={m.id}>
                {sep ? <li className={styles.day}>{dayLabel(m.createdAt)}</li> : null}
                <li className={`${styles.msg} ${m.mine ? styles.mine : ""} ${isSys ? styles.system : ""}`}>
                  {isSys ? null : (
                    <div className={styles.head}>
                      <span className={styles.author}>{m.mine ? "Sen" : (m.author?.name ?? "Bilinmiyor")}</span>
                      <time dateTime={m.createdAt}>{timeFmt.format(new Date(m.createdAt))}</time>
                      {m.requestId ? <span className={styles.tag}>{reqKind ? REQ_TAG[reqKind] : "Talep"}</span> : null}
                    </div>
                  )}
                  <div className={styles.body}>{renderBody(m.body, usernames)}</div>
                  {isSys ? (
                    <time className={styles.hint} dateTime={m.createdAt}>
                      {timeFmt.format(new Date(m.createdAt))}
                    </time>
                  ) : null}
                </li>
              </Fragment>
            );
          })}
        </ul>
        {unseen ? (
          <button
            type="button"
            className={`btn-solid ${styles.newBtn}`}
            onClick={() => {
              scrollBottom();
              setUnseen(false);
              markRead();
            }}
          >
            Yeni mesajlar ↓
          </button>
        ) : null}
      </div>

      {view.canWrite ? (
        <form
          className={styles.compose}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {view.pendingRequest ? (
            <p className={styles.hint}>Mesajın bekleyen {REQ_PLAIN[view.pendingRequest.kind]} talebine bağlanacak.</p>
          ) : null}
          {sugg && matches.length > 0 ? (
            <ul className={styles.sugg} role="listbox" aria-label="Kişi önerileri">
              {matches.map((u, i) => (
                <li key={u.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === suggIdx}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(u.username)}
                  >
                    {u.name} <span className="muted">@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className={styles.row}>
            <label className="sr-only" htmlFor={`msg-${channelId}`}>
              Mesaj yaz
            </label>
            <textarea
              id={`msg-${channelId}`}
              ref={taRef}
              className="textarea"
              rows={1}
              value={body}
              placeholder="Mesaj yaz…"
              maxLength={MESSAGE_MAX}
              onChange={(e) => {
                setBody(e.target.value);
                detectMention(e.target.value, e.target.selectionStart);
              }}
              onKeyDown={onKeyDown}
              onClick={(e) => detectMention(body, e.currentTarget.selectionStart)}
            />
            <button type="submit" className="btn-solid" disabled={sending || body.trim() === ""}>
              Gönder
            </button>
          </div>
          <div className={styles.counter} aria-hidden="true">
            {body.length} / {MESSAGE_MAX}
          </div>
        </form>
      ) : (
        <p className={styles.hint}>{view.writeHint ?? "Bu kanala yazamazsın."}</p>
      )}
      <p className={styles.err} role="alert" hidden={!error}>
        {error}
      </p>
    </div>
  );
}
