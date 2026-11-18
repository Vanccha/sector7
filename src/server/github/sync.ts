/**
 * Ticket → GitHub issue uzlaştırması (Aşama 7.5). Durum tabanlı ve idempotent: ticket'ın GÜNCEL hâlinden
 * GitHub'da olması gerekeni hesaplar ve uygular. Ağ çağrıları transaction dışında; DB yazımları tek ifadelik.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { areas, githubMilestones, sprints, ticketDependencies, tickets, user } from "@/db/schema";
import { sprintLabel, sprintMilestoneTitle, ticketBranch } from "@/lib/contracts/github";
import type { TicketStatus } from "@/lib/contracts/plan";
import { isInProgress } from "@/lib/contracts/tickets";
import { getAppBotLogin, GithubError, githubOrg, githubRequest } from "./app";

const LABEL_COLOR = "ededed";
const BODY_LIMIT = 60_000;
const SPRINT_LABEL_RE = /^sprint-\d+$/;

/** Depo+etiket başına "var" önbelleği (süreç ömrü). */
const labelCache = new Set<string>();
export function __resetGithubSyncCacheForTests(): void {
  labelCache.clear();
}

const seg = (v: string) => encodeURIComponent(v);
const repoPath = (repo: string) => `/repos/${seg(githubOrg())}/${seg(repo)}`;
const refPath = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

type Issue = { number: number; html_url: string; labels?: ({ name?: string } | string)[] };

async function ensureLabel(repo: string, name: string): Promise<void> {
  const key = `${repo}\n${name}`;
  if (labelCache.has(key)) return;
  try {
    await githubRequest("GET", `${repoPath(repo)}/labels/${seg(name)}`);
  } catch (e) {
    if (!(e instanceof GithubError) || e.status !== 404) throw e;
    try {
      await githubRequest("POST", `${repoPath(repo)}/labels`, { name, color: LABEL_COLOR });
    } catch (e2) {
      if (!(e2 instanceof GithubError) || e2.status !== 422) throw e2; // 422: başka biri açmış
    }
  }
  labelCache.add(key);
}

/** Sprint milestone numarası: önce önbellek tablosu; yoksa başlıkla bul; yoksa oluştur. */
async function ensureMilestone(
  db: DbOrTx,
  repo: string,
  sprintId: string,
  sprintNumber: number,
  forceRefresh: boolean,
): Promise<number> {
  if (!forceRefresh) {
    const [row] = await db
      .select({ number: githubMilestones.number })
      .from(githubMilestones)
      .where(and(eq(githubMilestones.repo, repo), eq(githubMilestones.sprintId, sprintId)))
      .limit(1);
    if (row) return row.number;
  } else {
    await db.delete(githubMilestones).where(and(eq(githubMilestones.repo, repo), eq(githubMilestones.sprintId, sprintId)));
  }
  const title = sprintMilestoneTitle(sprintNumber);
  let found: number | null = null;
  for (let page = 1; page <= 10 && found === null; page++) {
    const list = await githubRequest<{ number: number; title: string }[]>(
      "GET",
      `${repoPath(repo)}/milestones?state=all&per_page=100&page=${page}`,
    );
    found = list.find((m) => m.title === title)?.number ?? null;
    if (list.length < 100) break;
  }
  if (found === null) {
    const created = await githubRequest<{ number: number }>("POST", `${repoPath(repo)}/milestones`, { title });
    found = created.number;
  }
  await db.insert(githubMilestones).values({ repo, sprintId, number: found }).onConflictDoUpdate({
    target: [githubMilestones.repo, githubMilestones.sprintId],
    set: { number: found },
  });
  return found;
}

async function ensureBranch(repo: string, branch: string): Promise<void> {
  const info = await githubRequest<{ default_branch: string }>("GET", repoPath(repo));
  const ref = await githubRequest<{ object: { sha: string } }>(
    "GET",
    `${repoPath(repo)}/git/ref/heads/${refPath(info.default_branch)}`,
  );
  try {
    await githubRequest("POST", `${repoPath(repo)}/git/refs`, { ref: `refs/heads/${branch}`, sha: ref.object.sha });
  } catch (e) {
    if (!(e instanceof GithubError) || e.status !== 422) throw e; // 422: dal zaten var
  }
}

const marker = (ticketId: string) => `<!-- sector7:ticket:${ticketId} -->`;

/** Çift issue'ya karşı: aynı depoda işaretçiyi taşıyan (App botunun açtığı) issue'yu en çok 3 sayfada arar. */
async function findIssueByMarker(repo: string, label: string, ticketId: string): Promise<Issue | null> {
  const bot = await getAppBotLogin();
  const needle = marker(ticketId);
  for (let page = 1; page <= 3; page++) {
    const q = `state=all&labels=${seg(label)}&per_page=100&page=${page}${bot ? `&creator=${seg(bot)}` : ""}`;
    const list = await githubRequest<(Issue & { body?: string | null; pull_request?: unknown })[]>(
      "GET",
      `${repoPath(repo)}/issues?${q}`,
    );
    const hit = list.find((i) => !i.pull_request && typeof i.body === "string" && i.body.includes(needle));
    if (hit) return hit;
    if (list.length < 100) break;
  }
  return null;
}

export function buildIssueBody(description: string, prerequisites: string[], ticketId?: string): string {
  const parts: string[] = [];
  const desc = description.trim().slice(0, BODY_LIMIT);
  if (desc) parts.push(desc);
  if (prerequisites.length > 0) parts.push(`### Ön koşullar\n${prerequisites.map((p) => `- ${p}`).join("\n")}`);
  parts.push("---\n_Bu issue SECTOR7'den yönetilir; durum değişiklikleri SECTOR7'de yapılır._");
  if (ticketId) parts.push(marker(ticketId));
  return parts.join("\n\n");
}

function desiredState(status: TicketStatus): { state: "open" | "closed"; reason?: "not_planned" | "completed" } {
  if (status === "cancelled") return { state: "closed", reason: "not_planned" };
  if (status === "evaluated") return { state: "closed", reason: "completed" };
  return { state: "open" };
}

export async function reconcileTicket(db: DbOrTx, ticketId: string): Promise<void> {
  const [t] = await db
    .select({
      id: tickets.id,
      title: tickets.title,
      description: tickets.description,
      status: tickets.status,
      sprintId: tickets.sprintId,
      sprintNumber: sprints.number,
      repo: areas.githubRepo,
      issueNumber: tickets.githubIssueNumber,
      branch: tickets.githubBranch,
      assigneeLogin: user.githubLogin,
    })
    .from(tickets)
    .innerJoin(areas, eq(areas.id, tickets.areaId))
    .innerJoin(sprints, eq(sprints.id, tickets.sprintId))
    .leftJoin(user, eq(user.id, tickets.assigneeId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!t || !t.repo || t.status === "draft") return;
  const repo = t.repo;

  const deps = await db
    .select({
      number: tickets.githubIssueNumber,
      title: tickets.title,
      areaName: areas.name,
      repo: areas.githubRepo,
    })
    .from(ticketDependencies)
    .innerJoin(tickets, eq(tickets.id, ticketDependencies.dependsOnId))
    .innerJoin(areas, eq(areas.id, tickets.areaId))
    .where(eq(ticketDependencies.ticketId, ticketId))
    .orderBy(tickets.title);
  const prerequisites = deps.map((d) =>
    d.repo === repo && d.number !== null ? `#${d.number}` : `${d.areaName} · ${d.title}`,
  );

  const label = sprintLabel(t.sprintNumber);
  await ensureLabel(repo, label);

  const { state, reason } = desiredState(t.status);
  const assignees = (isInProgress(t.status) || t.status === "submitted") && t.assigneeLogin ? [t.assigneeLogin] : [];
  const body = buildIssueBody(t.description, prerequisites, ticketId);

  let issueNumber = t.issueNumber;
  let existing: Issue | null = null;
  if (issueNumber !== null) {
    try {
      existing = await githubRequest<Issue>("GET", `${repoPath(repo)}/issues/${issueNumber}`);
    } catch (e) {
      if (!(e instanceof GithubError) || e.status !== 404) throw e;
      // Issue silinmiş/taşınmış: yeniden açılır.
      issueNumber = null;
      await db
        .update(tickets)
        .set({ githubIssueNumber: null, githubIssueUrl: null })
        .where(eq(tickets.id, ticketId));
    }
  }

  // Issue açılmadan hemen önce (yalnız bu durumda): daha önce açılıp numarası kaydedilemeyen issue var mı?
  if (issueNumber === null) {
    const found = await findIssueByMarker(repo, label, ticketId);
    if (found) {
      issueNumber = found.number;
      existing = found;
      await db
        .update(tickets)
        .set({ githubIssueNumber: found.number, githubIssueUrl: found.html_url })
        .where(eq(tickets.id, ticketId));
    }
  }

  // Milestone 422 verirse (GitHub'da silinmiş olabilir) önbelleği yenileyip bir kez daha denenir.
  for (let attempt = 0; ; attempt++) {
    const milestone = await ensureMilestone(db, repo, t.sprintId, t.sprintNumber, attempt > 0);
    try {
      if (issueNumber === null) {
        const created = await githubRequest<Issue>("POST", `${repoPath(repo)}/issues`, {
          title: t.title,
          body,
          labels: [label],
          milestone,
          assignees,
        });
        issueNumber = created.number;
        await db
          .update(tickets)
          .set({ githubIssueNumber: created.number, githubIssueUrl: created.html_url })
          .where(eq(tickets.id, ticketId));
        if (state === "closed") {
          await githubRequest("PATCH", `${repoPath(repo)}/issues/${created.number}`, { state, state_reason: reason });
        }
      } else {
        const kept = (existing?.labels ?? [])
          .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
          .filter((n) => n && !SPRINT_LABEL_RE.test(n));
        const updated = await githubRequest<Issue>("PATCH", `${repoPath(repo)}/issues/${issueNumber}`, {
          title: t.title,
          body,
          labels: [...kept, label],
          milestone,
          assignees,
          state,
          ...(reason ? { state_reason: reason } : {}),
        });
        if (updated?.html_url) {
          await db
            .update(tickets)
            .set({ githubIssueNumber: updated.number, githubIssueUrl: updated.html_url })
            .where(eq(tickets.id, ticketId));
        }
      }
      break;
    } catch (e) {
      if (attempt === 0 && e instanceof GithubError && e.status === 422) continue;
      throw e;
    }
  }

  // İş dalı: ticket ilk kez alındığında; asla silinmez.
  if (isInProgress(t.status) && !t.branch) {
    const branch = ticketBranch(t.sprintNumber, ticketId, t.title);
    await ensureBranch(repo, branch);
    await db.update(tickets).set({ githubBranch: branch }).where(and(eq(tickets.id, ticketId), sql`github_branch is null`));
  }
}
