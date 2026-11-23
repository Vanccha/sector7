import { db } from "@/db";
import { HqBackground } from "@/components/shell/HqBackground";
import { AppHeader } from "@/components/shell/AppHeader";
import { requirePageActor } from "@/lib/auth/session";
import { getRequestSprint } from "@/lib/current-sprint-request";
import { LiveCountsProvider } from "@/components/shell/LiveCounts";
import { unreadMessageCount } from "@/server/messaging";
import { unreadNotificationCount } from "@/server/notifications";

/** Oturum gerektiren tüm sayfaların kabuğu. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor();
  const [sprint, unreadMessages, unreadNotifications] = await Promise.all([
    getRequestSprint(),
    unreadMessageCount(db, actor).catch(() => 0),
    unreadNotificationCount(db, actor).catch(() => 0),
  ]);
  return (
    <div className="app-shell">
      <HqBackground />
      <LiveCountsProvider userId={actor.id} initialMessages={unreadMessages} initialNotifications={unreadNotifications}>
        <a href="#icerik" className="skip-link">
          İçeriğe geç
        </a>
        <AppHeader actor={actor} sprint={sprint} />
        <main id="icerik" className="app-main">
          {children}
        </main>
      </LiveCountsProvider>
    </div>
  );
}
