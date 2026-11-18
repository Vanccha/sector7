/** Ticket sayfasındaki GitHub bilgisi (Aşama 7.5). */
import { desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { areas, githubOutbox, ticketPullRequests, tickets } from "@/db/schema";
import { canManageArea } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import type { TicketGithubView } from "@/lib/contracts/github";
import { canViewTicket } from "../ticket-common";
import { githubOrg, githubSyncEnabled } from "./app";

/** Senkron kapalıysa, ticket yoksa/görülemiyorsa ya da alanın deposu yoksa null. */
export async function getTicketGithubView(
  db: DbOrTx,
  actor: Actor | null,
  ticketId: string,
): Promise<TicketGithubView | null> {
  if (!githubSyncEnabled() || !actor) return null;
  const [t] = await db
    .select({
      areaId: tickets.areaId,
      assigneeId: tickets.assigneeId,
      issueUrl: tickets.githubIssueUrl,
      branch: tickets.githubBranch,
      repo: areas.githubRepo,
    })
    .from(tickets)
    .innerJoin(areas, eq(areas.id, tickets.areaId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!t || !t.repo || !canViewTicket(actor, t)) return null;

  const prs = await db
    .select({
      id: ticketPullRequests.id,
      number: ticketPullRequests.number,
      url: ticketPullRequests.url,
      title: ticketPullRequests.title,
      state: ticketPullRequests.state,
      merged: ticketPullRequests.merged,
    })
    .from(ticketPullRequests)
    .where(eq(ticketPullRequests.ticketId, ticketId))
    .orderBy(desc(ticketPullRequests.updatedAt));

  let syncPending = false;
  let syncError: string | null = null;
  if (canManageArea(actor, t.areaId)) {
    const [o] = await db
      .select({ lastError: githubOutbox.lastError })
      .from(githubOutbox)
      .where(eq(githubOutbox.ticketId, ticketId))
      .limit(1);
    syncPending = !!o;
    syncError = o?.lastError ?? null;
  }

  return {
    repo: t.repo,
    issueUrl: t.issueUrl,
    branch: t.branch,
    branchUrl: t.branch
      ? `https://github.com/${encodeURIComponent(githubOrg())}/${encodeURIComponent(t.repo)}/tree/${t.branch
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`
      : null,
    pullRequests: prs,
    readyToSubmit: prs.some((p) => p.merged),
    syncPending,
    syncError,
  };
}
