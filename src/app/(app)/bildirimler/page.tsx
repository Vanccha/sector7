import Link from "next/link";
import { NotificationList } from "@/components/notifications/NotificationList";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { listNotifications } from "@/server/notifications";

export const metadata = { title: "Bildirimler" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const actor = await requirePageActor();
  const initial = await listNotifications(db, actor, {});
  return (
    <div className="page page--medium">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
          Bildirimler
        </h1>
        <Link href="/bildirimler/tercihler" className="btn-line">
          Tercihler
        </Link>
      </div>
      <NotificationList initial={initial} nowIso={new Date().toISOString()} />
    </div>
  );
}
