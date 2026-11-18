import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { AppError } from "@/lib/contracts/errors";
import type { ChannelView } from "@/lib/contracts/messaging";
import { ChannelThread } from "@/components/messaging/ChannelThread";
import { getChannelView } from "@/server/messaging";
import styles from "../Mesajlar.module.css";

export const metadata = { title: "Mesajlar" };

const KIND_LABEL = { area: "Alan kanalı", ticket: "Ticket konuşması", announcement: "Duyurular" } as const;

export default async function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const actor = await requirePageActor();
  let view: ChannelView | null = null;
  try {
    view = await getChannelView(db, actor, { channelId });
  } catch (e) {
    const missing = e instanceof ZodError || (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN"));
    if (!missing) throw e;
  }
  if (!view) notFound();
  const c = view.channel;

  return (
    <div className={styles.chatPage}>
      <header className={styles.chatHead}>
        <div className={styles.meta}>
          <Link href="/mesajlar">← Mesajlar</Link>
          <span>{KIND_LABEL[c.kind]}</span>
          {c.kind === "area" && c.areaName ? <span>{c.areaName}</span> : null}
          {c.archived ? <span className="badge">arşiv</span> : null}
          {c.kind === "ticket" && c.ticketId ? <Link href={`/ticket/${c.ticketId}`}>Ticket&apos;a git</Link> : null}
        </div>
        <h1 className="h-wide">{c.name}</h1>
      </header>
      <ChannelThread key={c.id} view={view} ticketChannel={c.kind === "ticket"} fill />
    </div>
  );
}
