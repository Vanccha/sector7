/** Canlı çalışma haritası: kim şu an hangi alanın ticket'ı üzerinde çalışıyor. Salt okuma; kişisel veri yok. */
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { areas, tickets, user } from "@/db/schema";
import { requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { forbidden } from "@/lib/contracts/errors";
import type { LiveMap, LiveMapLink } from "@/lib/contracts/live-map";
import { IN_PROGRESS_STATUSES } from "@/lib/contracts/tickets";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "tr");

export async function getLiveMap(db: DbOrTx, actor: Actor): Promise<LiveMap> {
  requireActor(actor);
  const [me] = await db.select({ active: user.active }).from(user).where(eq(user.id, actor.id)).limit(1);
  if (!me?.active) throw forbidden("Hesabın pasif.");

  const rows = await db
    .select({
      ticketId: tickets.id,
      title: tickets.title,
      areaId: tickets.areaId,
      userId: tickets.assigneeId,
      status: tickets.status,
      takenAt: tickets.takenAt,
      pausedAt: tickets.pausedAt,
      userName: user.name,
      userHomeAreaId: user.homeAreaId,
    })
    .from(tickets)
    .innerJoin(user, and(eq(user.id, tickets.assigneeId), eq(user.active, true)))
    .where(and(inArray(tickets.status, [...IN_PROGRESS_STATUSES]), isNotNull(tickets.assigneeId)));

  const links: LiveMapLink[] = [];
  const people = new Map<string, { id: string; name: string; homeAreaId: string | null }>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.userId) continue;
    links.push({
      ticketId: r.ticketId,
      title: r.title,
      areaId: r.areaId,
      userId: r.userId,
      status: r.status,
      takenAt: r.takenAt ? r.takenAt.toISOString() : null,
      paused: r.pausedAt != null,
    });
    people.set(r.userId, { id: r.userId, name: r.userName, homeAreaId: r.userHomeAreaId });
    counts.set(r.areaId, (counts.get(r.areaId) ?? 0) + 1);
  }

  const linked = [...counts.keys()];
  const areaRows = await db
    .select({ id: areas.id, name: areas.name, archivedAt: areas.archivedAt })
    .from(areas)
    .where(linked.length > 0 ? or(isNull(areas.archivedAt), inArray(areas.id, linked)) : isNull(areas.archivedAt))
    .orderBy(asc(areas.name));

  return {
    areas: areaRows
      .map((a) => ({ id: a.id, name: a.name, archived: a.archivedAt != null, activeCount: counts.get(a.id) ?? 0 }))
      .sort(byName),
    people: [...people.values()].sort(byName),
    links,
    generatedAt: new Date().toISOString(),
  };
}
