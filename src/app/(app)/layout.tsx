import { db } from "@/db";
import { AppHeader } from "@/components/shell/AppHeader";
import { requirePageActor } from "@/lib/auth/session";
import { getActiveSprintView } from "@/lib/current-sprint";
import { LiveCountsProvider } from "@/components/shell/LiveCounts";
import { unreadMessageCount } from "@/server/messaging";
import { unreadNotificationCount } from "@/server/notifications";

/** Oturum gerektiren tüm sayfaların kabuğu. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor();
  const [sprint, unreadMessages, unreadNotifications] = await Promise.all([
    getActiveSprintView(db),
    unreadMessageCount(db, actor).catch(() => 0),
    unreadNotificationCount(db, actor).catch(() => 0),
  ]);
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <LiveCountsProvider userId={actor.id} initialMessages={unreadMessages} initialNotifications={unreadNotifications}>
        <AppHeader actor={actor} sprint={sprint} />
      <main style={{ flex: "1 1 auto", padding: "24px var(--gutter) 48px", width: "100%", maxWidth: 1200, margin: "0 auto" }}>
        {children}
      </main>
      </LiveCountsProvider>
    </div>
  );
}
