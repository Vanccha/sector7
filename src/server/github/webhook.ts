/** GitHub webhook işleyicisi (Aşama 7.5 adım 3). Next.js'e bağımlı değildir; testlerde doğrudan çağrılır. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { areas, githubWebhookDeliveries, ticketPullRequests, tickets } from "@/db/schema";
import { shortIdFromBranch } from "@/lib/contracts/github";
import { publishEvent } from "@/server/realtime/publish";

export type WebhookResult = { status: "ok" | "duplicate" | "ignored" };

/** `X-Hub-Signature-256` doğrulaması (HMAC-SHA256, sabit zamanlı karşılaştırma). */
export function verifyGithubSignature(rawBody: string | Buffer, header: string | null, secret: string): boolean {
  if (!header || !secret || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  const given = Buffer.from(header.slice("sha256=".length), "utf8");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

const repositorySchema = z.object({ name: z.string().min(1), owner: z.object({ login: z.string().min(1) }) });

const pullRequestPayload = z.object({
  action: z.string(),
  repository: repositorySchema,
  pull_request: z.object({
    number: z.number().int(),
    title: z.string(),
    html_url: z.string(),
    state: z.enum(["open", "closed"]),
    merged: z.boolean().nullish(),
    body: z.string().nullish(),
    head: z.object({ ref: z.string() }),
    user: z.object({ login: z.string() }).nullish(),
  }),
});

const issuesPayload = z.object({
  action: z.string(),
  repository: repositorySchema,
  issue: z.object({ number: z.number().int() }),
  sender: z.object({ type: z.string().optional(), login: z.string().optional() }).nullish(),
  performed_via_github_app: z.object({ id: z.number().int() }).nullish(),
});

const PR_ACTIONS = new Set(["opened", "edited", "reopened", "synchronize", "closed"]);
const ISSUE_ACTIONS = new Set(["closed", "reopened", "edited"]);
const CLOSING_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;

export async function handleGithubEvent(
  db: DB,
  input: { event: string; deliveryId: string; payload: unknown },
): Promise<WebhookResult> {
  const { event, deliveryId, payload } = input;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(githubWebhookDeliveries)
      .values({ deliveryId, event })
      .onConflictDoNothing()
      .returning({ id: githubWebhookDeliveries.deliveryId });
    if (inserted.length === 0) return { status: "duplicate" };

    if (event === "ping") return { status: "ok" };
    if (event !== "pull_request" && event !== "issues") return { status: "ignored" };

    const org = process.env.GITHUB_ORG;
    if (!org) return { status: "ignored" };

    if (event === "pull_request") {
      const p = pullRequestPayload.safeParse(payload);
      if (!p.success || !PR_ACTIONS.has(p.data.action)) return { status: "ignored" };
      const { repository, pull_request: pr } = p.data;
      if (repository.owner.login.toLowerCase() !== org.toLowerCase()) return { status: "ignored" };
      const areaId = await findAreaId(tx, repository.name);
      if (!areaId) return { status: "ignored" };

      let ticketId: string | null = null;
      const shortId = shortIdFromBranch(pr.head.ref);
      if (shortId) {
        const rows = await tx
          .select({ id: tickets.id })
          .from(tickets)
          .where(and(eq(tickets.areaId, areaId), sql`replace(${tickets.id}::text, '-', '') like ${shortId + "%"}`))
          .limit(2);
        if (rows.length === 1) ticketId = rows[0]!.id;
      }
      if (!ticketId && pr.body) {
        for (const m of pr.body.matchAll(CLOSING_RE)) {
          const n = Number(m[1]);
          if (!Number.isSafeInteger(n)) continue;
          const [row] = await tx
            .select({ id: tickets.id })
            .from(tickets)
            .where(and(eq(tickets.areaId, areaId), eq(tickets.githubIssueNumber, n)))
            .limit(1);
          if (row) {
            ticketId = row.id;
            break;
          }
        }
      }
      if (!ticketId) return { status: "ignored" };

      // Ticket durumu DEĞİŞMEZ: PR birleşmesi teslim sayılmaz.
      const values = {
        repo: repository.name,
        number: pr.number,
        url: pr.html_url,
        title: pr.title,
        state: pr.state,
        merged: pr.merged === true,
        authorLogin: pr.user?.login ?? null,
      };
      await tx
        .insert(ticketPullRequests)
        .values({ ...values, ticketId })
        .onConflictDoUpdate({
          target: [ticketPullRequests.repo, ticketPullRequests.number],
          set: { ...values, updatedAt: new Date() },
        });
      await publishEvent(tx, { kind: "tickets", areaId });
      return { status: "ok" };
    }

    // issues
    const p = issuesPayload.safeParse(payload);
    if (!p.success || !ISSUE_ACTIONS.has(p.data.action)) return { status: "ignored" };
    const { repository, issue, sender, performed_via_github_app: via } = p.data;
    if (repository.owner.login.toLowerCase() !== org.toLowerCase()) return { status: "ignored" };
    // Kendi App'imizin yaptığı değişiklik: döngüyü önle.
    const appId = Number(process.env.GITHUB_APP_ID);
    if (sender?.type === "Bot" && via && Number.isFinite(appId) && via.id === appId) return { status: "ignored" };
    const areaId = await findAreaId(tx, repository.name);
    if (!areaId) return { status: "ignored" };
    const [t] = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.areaId, areaId), eq(tickets.githubIssueNumber, issue.number)))
      .limit(1);
    if (!t) return { status: "ignored" };
    // SECTOR7 kaynak: senkron issue'yu ticket durumuna geri getirir. Ticket durumu değişmez.
    await tx.execute(sql`select github_outbox_enqueue(${t.id}::uuid)`);
    return { status: "ok" };
  });
}

async function findAreaId(tx: Pick<DB, "select">, repo: string): Promise<string | null> {
  const rows = await tx.select({ id: areas.id }).from(areas).where(eq(areas.githubRepo, repo)).limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}
