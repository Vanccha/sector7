import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { MyTicketsView } from "@/components/tickets/MyTicketsView";
import { getMyTickets } from "@/server/pool";

export const metadata = { title: "Ticket'larım" };

export default async function MyTicketsPage() {
  const actor = await requirePageActor();
  const view = await getMyTickets(db, actor);
  return (
    <div className="page">
      <h1 className="h-wide" style={{ margin: 0, fontSize: 26, lineHeight: 1.2 }}>
        Ticket&apos;larım
      </h1>
      <MyTicketsView view={view} />
    </div>
  );
}
