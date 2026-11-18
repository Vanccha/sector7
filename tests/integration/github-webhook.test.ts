import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/github/webhook/route";
import { areas, githubOutbox, githubWebhookDeliveries, ticketPullRequests, tickets } from "../../src/db/schema";
import type { ServerEvent } from "../../src/lib/contracts/realtime";
import { handleGithubEvent, verifyGithubSignature } from "../../src/server/github/webhook";
import { db, resetDb } from "../helpers/db";
import { setupCycle, takenTicket, ticketById, type Cycle } from "../helpers/cycle";
import {
  GH_APP_ID,
  GH_ORG,
  GH_WEBHOOK_SECRET,
  enableGithubEnv,
  restoreGithubEnv,
  signBody,
} from "../helpers/fake-github";
import { makeTicketRow } from "../helpers/plan";
import { openListener } from "../helpers/messaging";

beforeEach(async () => {
  await resetDb();
  enableGithubEnv();
});
afterEach(() => restoreGithubEnv());

const shortOf = (id: string) => id.replace(/-/g, "").slice(0, 8);
let seq = 0;
const delivery = () => `d-${Date.now()}-${++seq}`;

async function world() {
  const c = await setupCycle();
  await db.update(areas).set({ githubRepo: "repo-a" }).where(eq(areas.id, c.areaA.id));
  return c;
}

const prPayload = (o: {
  ref: string;
  number?: number;
  action?: string;
  merged?: boolean;
  state?: "open" | "closed";
  body?: string | null;
  repo?: string;
  owner?: string;
  title?: string;
}) => ({
  action: o.action ?? "opened",
  repository: { name: o.repo ?? "repo-a", owner: { login: o.owner ?? GH_ORG } },
  pull_request: {
    number: o.number ?? 1,
    title: o.title ?? "Hero PR",
    html_url: `https://github.com/${GH_ORG}/${o.repo ?? "repo-a"}/pull/${o.number ?? 1}`,
    state: o.state ?? "open",
    merged: o.merged ?? false,
    body: o.body ?? null,
    head: { ref: o.ref },
    user: { login: "octocat" },
  },
});

const send = (event: string, payload: unknown, deliveryId = delivery()) =>
  handleGithubEvent(db, { event, deliveryId, payload });

const prRows = () => db.select().from(ticketPullRequests);

/* ------------------------------ imza ------------------------------ */

describe("verifyGithubSignature", () => {
  const body = '{"a":1}';
  it("doğru imza kabul edilir (string ve Buffer gövde)", () => {
    expect(verifyGithubSignature(body, signBody(body), GH_WEBHOOK_SECRET)).toBe(true);
    expect(verifyGithubSignature(Buffer.from(body), signBody(body), GH_WEBHOOK_SECRET)).toBe(true);
  });
  it("yanlış imza, yanlış secret ve değişmiş gövde reddedilir", () => {
    expect(verifyGithubSignature(body, signBody(body, "baska-secret"), GH_WEBHOOK_SECRET)).toBe(false);
    expect(verifyGithubSignature(body, signBody("{}"), GH_WEBHOOK_SECRET)).toBe(false);
    expect(verifyGithubSignature(body, "sha256=" + "0".repeat(64), GH_WEBHOOK_SECRET)).toBe(false);
  });
  it("eksik başlık, boş secret ve sha256= öneksiz değer reddedilir", () => {
    expect(verifyGithubSignature(body, null, GH_WEBHOOK_SECRET)).toBe(false);
    expect(verifyGithubSignature(body, "", GH_WEBHOOK_SECRET)).toBe(false);
    expect(verifyGithubSignature(body, signBody(body), "")).toBe(false);
    expect(verifyGithubSignature(body, signBody(body).replace("sha256=", ""), GH_WEBHOOK_SECRET)).toBe(false);
    expect(verifyGithubSignature(body, signBody(body).replace("sha256=", "sha1="), GH_WEBHOOK_SECRET)).toBe(false);
  });
  it("uzunluk farkı (kısa/uzun imza) istisna fırlatmadan reddedilir", () => {
    const good = signBody(body);
    expect(verifyGithubSignature(body, good.slice(0, -2), GH_WEBHOOK_SECRET)).toBe(false);
    expect(verifyGithubSignature(body, good + "ab", GH_WEBHOOK_SECRET)).toBe(false);
    expect(verifyGithubSignature(body, "sha256=", GH_WEBHOOK_SECRET)).toBe(false);
  });
});

/* ------------------------------ route ------------------------------ */

function req(body: string, headers: Record<string, string | null> = {}, sign = true) {
  const h = new Headers();
  const all: Record<string, string | null> = {
    "x-github-event": "ping",
    "x-github-delivery": delivery(),
    "x-hub-signature-256": sign ? signBody(body) : null,
    ...headers,
  };
  for (const [k, v] of Object.entries(all)) if (v !== null) h.set(k, v);
  return new Request("http://localhost:3000/api/github/webhook", { method: "POST", headers: h, body });
}

describe("POST /api/github/webhook", () => {
  it("secret tanımlı değilse 404 (geçerli imza olsa bile)", async () => {
    enableGithubEnv({ GITHUB_WEBHOOK_SECRET: undefined });
    const body = "{}";
    const res = await POST(req(body, { "x-hub-signature-256": signBody(body) }));
    expect(res.status).toBe(404);
  });

  it("imza yanlışsa ya da yoksa 401; teslimat kaydedilmez", async () => {
    const body = "{}";
    expect((await POST(req(body, { "x-hub-signature-256": signBody(body, "yanlis") }))).status).toBe(401);
    expect((await POST(req(body, {}, false))).status).toBe(401);
    expect(await db.select().from(githubWebhookDeliveries)).toHaveLength(0);
  });

  it("gövde 1 MB'ı aşarsa 413 (imza doğru olsa da)", async () => {
    const big = JSON.stringify({ pad: "x".repeat(1024 * 1024 + 10) });
    const res = await POST(req(big));
    expect(res.status).toBe(413);
  });

  it("Content-Length 1 MB'ı aşıyorsa gövde okunmadan 413", async () => {
    const res = await POST(req("{}", { "content-length": String(2 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("tam 1 MB gövde 413 değildir", async () => {
    // JSON: {"pad":"..."} toplam 1048576 bayt.
    const overhead = Buffer.byteLength(JSON.stringify({ pad: "" }));
    const body = JSON.stringify({ pad: "x".repeat(1024 * 1024 - overhead) });
    expect(Buffer.byteLength(body)).toBe(1024 * 1024);
    const res = await POST(req(body));
    expect(res.status).toBe(200);
  });

  it("imzalı ama bozuk JSON 400", async () => {
    const res = await POST(req("{bozuk json"));
    expect(res.status).toBe(400);
  });

  it("olay ya da teslimat başlığı eksikse 400", async () => {
    expect((await POST(req("{}", { "x-github-event": null }))).status).toBe(400);
    expect((await POST(req("{}", { "x-github-delivery": null }))).status).toBe(400);
  });

  it("ping 200 döner", async () => {
    const res = await POST(req('{"zen":"Keep it logically awesome."}', { "x-github-event": "ping" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("pull_request olayı route üzerinden işlenir; tekrar gelen teslimat duplicate döner", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const body = JSON.stringify(prPayload({ ref: `sprint-01/${shortOf(t.id)}-x` }));
    const id = delivery();
    const r1 = await POST(req(body, { "x-github-event": "pull_request", "x-github-delivery": id }));
    expect(await r1.json()).toEqual({ status: "ok" });
    const r2 = await POST(req(body, { "x-github-event": "pull_request", "x-github-delivery": id }));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ status: "duplicate" });
    expect(await prRows()).toHaveLength(1);
  });
});

/* ------------------------------ teslimat ------------------------------ */

describe("handleGithubEvent: teslimat", () => {
  it("aynı X-GitHub-Delivery ikinci kez gelirse duplicate döner ve hiçbir şey yapılmaz", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const ref = `sprint-01/${shortOf(t.id)}-x`;
    const id = delivery();
    expect((await send("pull_request", prPayload({ ref, state: "open" }), id)).status).toBe("ok");
    // Aynı teslimat kimliği ama farklı içerik: işlenmemeli.
    const r = await send("pull_request", prPayload({ ref, state: "closed", merged: true }), id);
    expect(r.status).toBe("duplicate");
    const rows = await prRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "open", merged: false });
    expect(await db.select().from(githubWebhookDeliveries)).toHaveLength(1);
  });

  it("eşzamanlı aynı teslimat: biri ok, diğeri duplicate", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const id = delivery();
    const p = prPayload({ ref: `sprint-01/${shortOf(t.id)}-x` });
    const rs = await Promise.all([send("pull_request", p, id), send("pull_request", p, id), send("pull_request", p, id)]);
    expect(rs.map((r) => r.status).sort()).toEqual(["duplicate", "duplicate", "ok"]);
    expect(await prRows()).toHaveLength(1);
  });

  it("başka org ya da bilinmeyen depo ignored döner", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const ref = `sprint-01/${shortOf(t.id)}-x`;
    expect((await send("pull_request", prPayload({ ref, owner: "baska-org" }))).status).toBe("ignored");
    expect((await send("pull_request", prPayload({ ref, repo: "bilinmeyen-depo" }))).status).toBe("ignored");
    expect((await send("issues", { action: "closed", repository: { name: "repo-a", owner: { login: "baska-org" } }, issue: { number: 1 } })).status).toBe("ignored");
    expect(await prRows()).toHaveLength(0);
  });

  it("org karşılaştırması harf duyarsızdır", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const r = await send("pull_request", prPayload({ ref: `sprint-01/${shortOf(t.id)}-x`, owner: GH_ORG.toUpperCase() }));
    expect(r.status).toBe("ok");
  });

  it("GITHUB_ORG yoksa ignored; desteklenmeyen olay ve geçersiz payload ignored", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    expect((await send("push", { ref: "refs/heads/main" })).status).toBe("ignored");
    expect((await send("pull_request", { bozuk: true })).status).toBe("ignored");
    expect((await send("pull_request", prPayload({ ref: `sprint-01/${shortOf(t.id)}-x`, action: "labeled" }))).status).toBe("ignored");
    enableGithubEnv({ GITHUB_ORG: undefined });
    expect((await send("pull_request", prPayload({ ref: `sprint-01/${shortOf(t.id)}-x` }))).status).toBe("ignored");
    expect(await prRows()).toHaveLength(0);
  });

  it("ping ok döner ve teslimat kaydedilir", async () => {
    const r = await send("ping", { zen: "x" }, "ping-1");
    expect(r.status).toBe("ok");
    expect(await db.select().from(githubWebhookDeliveries)).toHaveLength(1);
  });
});

/* ------------------------------ pull_request ------------------------------ */

describe("handleGithubEvent: pull_request eşleme", () => {
  it("dal öneki (kısa kimlik) ile eşlenir", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const r = await send("pull_request", prPayload({ ref: `sprint-01/${shortOf(t.id)}-ana-sayfa`, number: 12, title: "Hero" }));
    expect(r.status).toBe("ok");
    const rows = await prRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticketId: t.id,
      repo: "repo-a",
      number: 12,
      title: "Hero",
      state: "open",
      merged: false,
      authorLogin: "octocat",
      url: `https://github.com/${GH_ORG}/repo-a/pull/12`,
    });
  });

  it("dal öneki eşleşmezse gövdedeki `closes #N` ile eşlenir", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await db.update(tickets).set({ githubIssueNumber: 12, githubIssueUrl: "https://x/12" }).where(eq(tickets.id, t.id));
    for (const [i, body] of ["Closes #12", "fixes: #12", "Bu iş resolved #12 ile biter"].entries()) {
      const r = await send("pull_request", prPayload({ ref: "feature/hero", number: 20 + i, body }));
      expect(r.status, body).toBe("ok");
    }
    const rows = await prRows();
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.ticketId === t.id)).toBe(true);
  });

  it("kısa kimlik başka bir ticket'a aitse (öneki yanlış) closes #N yoluna düşer", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await db.update(tickets).set({ githubIssueNumber: 5 }).where(eq(tickets.id, t.id));
    const r = await send("pull_request", prPayload({ ref: "sprint-01/deadbeef-x", number: 3, body: "closes #5" }));
    expect(r.status).toBe("ok");
    expect((await prRows())[0]!.ticketId).toBe(t.id);
  });

  it("hiçbiri eşleşmezse ignored; PR kaydı yazılmaz", async () => {
    const c = await world();
    await takenTicket(c, c.areaA.id, c.member);
    expect((await send("pull_request", prPayload({ ref: "feature/x", body: "closes #999" }))).status).toBe("ignored");
    expect((await send("pull_request", prPayload({ ref: "feature/x", body: null }))).status).toBe("ignored");
    expect((await send("pull_request", prPayload({ ref: "feature/x", body: "bu bir kapatma değil #1" }))).status).toBe("ignored");
    expect(await prRows()).toHaveLength(0);
  });

  it("başka alanın ticket'ı eşlenmez (kısa kimlik ve closes #N alan içinde aranır)", async () => {
    const c = await world();
    const foreign = await makeTicketRow({ areaId: c.areaB.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "available", githubIssueNumber: 8 });
    expect((await send("pull_request", prPayload({ ref: `sprint-01/${shortOf(foreign.id)}-x` }))).status).toBe("ignored");
    expect((await send("pull_request", prPayload({ ref: "feature/x", body: "closes #8" }))).status).toBe("ignored");
    expect(await prRows()).toHaveLength(0);
  });

  it("upsert: opened sonra closed+merged aynı satırı günceller; ticket durumu DEĞİŞMEZ (otomatik teslim yok)", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const before = await ticketById(t.id);
    const ref = `sprint-01/${shortOf(t.id)}-x`;
    await send("pull_request", prPayload({ ref, number: 4, state: "open", title: "İlk" }));
    const first = (await prRows())[0]!;
    await send("pull_request", prPayload({ ref, number: 4, action: "closed", state: "closed", merged: true, title: "Son" }));
    const rows = await prRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, state: "closed", merged: true, title: "Son" });
    expect(rows[0]!.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());

    const after = await ticketById(t.id);
    expect(after.status).toBe("taken");
    expect(after.assigneeId).toBe(c.member.id);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("birleşmeden kapatılan PR merged=false kalır; merged alanı yoksa false", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const ref = `sprint-01/${shortOf(t.id)}-x`;
    const p = prPayload({ ref, number: 6, action: "closed", state: "closed" });
    (p.pull_request as Record<string, unknown>).merged = null;
    await send("pull_request", p);
    expect((await prRows())[0]).toMatchObject({ state: "closed", merged: false });
  });

  it("{kind:\"tickets\"} olayı yayınlanır (LISTEN)", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const L = await openListener();
    try {
      await send("pull_request", prPayload({ ref: `sprint-01/${shortOf(t.id)}-x` }));
      const e = await L.waitFor((x): x is Extract<ServerEvent, { kind: "tickets" }> => x.kind === "tickets" && x.areaId === c.areaA.id);
      expect(e).toEqual({ kind: "tickets", areaId: c.areaA.id });
    } finally {
      await L.close();
    }
  });

  it("eşleşmeyen PR olay yayınlamaz", async () => {
    const c = await world();
    await takenTicket(c, c.areaA.id, c.member);
    const L = await openListener();
    try {
      await send("pull_request", prPayload({ ref: "feature/x" }));
      await new Promise((r) => setTimeout(r, 300));
      expect(L.events.filter((e) => e.kind === "tickets")).toHaveLength(0);
    } finally {
      await L.close();
    }
  });
});

/* ------------------------------ issues ------------------------------ */

const issuesPayload = (number: number, extra: Record<string, unknown> = {}, action = "closed") => ({
  action,
  repository: { name: "repo-a", owner: { login: GH_ORG } },
  issue: { number },
  sender: { type: "User", login: "someone" },
  ...extra,
});

describe("handleGithubEvent: issues", () => {
  async function ticketWithIssue(c: Cycle) {
    const t = await takenTicket(c, c.areaA.id, c.member);
    await db.update(tickets).set({ githubIssueNumber: 31, githubIssueUrl: "https://x/31" }).where(eq(tickets.id, t.id));
    await db.delete(githubOutbox);
    return t;
  }

  it("closed gelince ticket kuyruğa girer, durumu değişmez", async () => {
    const c = await world();
    const t = await ticketWithIssue(c);
    const r = await send("issues", issuesPayload(31));
    expect(r.status).toBe("ok");
    const rows = await db.select().from(githubOutbox);
    expect(rows.map((x) => x.ticketId)).toEqual([t.id]);
    const after = await ticketById(t.id);
    expect(after.status).toBe("taken");
    expect(after.assigneeId).toBe(c.member.id);
  });

  it("reopened/edited de kuyruğa alır; desteklenmeyen eylem ignored", async () => {
    const c = await world();
    await ticketWithIssue(c);
    expect((await send("issues", issuesPayload(31, {}, "reopened"))).status).toBe("ok");
    expect((await send("issues", issuesPayload(31, {}, "labeled"))).status).toBe("ignored");
  });

  it("kendi App botundan gelen olay yok sayılır (döngü önlenir)", async () => {
    const c = await world();
    await ticketWithIssue(c);
    const r = await send(
      "issues",
      issuesPayload(31, { sender: { type: "Bot", login: "sector7-test[bot]" }, performed_via_github_app: { id: Number(GH_APP_ID) } }),
    );
    expect(r.status).toBe("ignored");
    expect(await db.select().from(githubOutbox)).toHaveLength(0);
  });

  it("başka bir bot/App'ten gelen olay yok sayılmaz", async () => {
    const c = await world();
    await ticketWithIssue(c);
    const r = await send(
      "issues",
      issuesPayload(31, { sender: { type: "Bot", login: "baska[bot]" }, performed_via_github_app: { id: 999 } }),
    );
    expect(r.status).toBe("ok");
    expect(await db.select().from(githubOutbox)).toHaveLength(1);
  });

  it("bilinmeyen issue numarası ya da bilinmeyen depo ignored", async () => {
    const c = await world();
    await ticketWithIssue(c);
    expect((await send("issues", issuesPayload(404))).status).toBe("ignored");
    expect(
      (await send("issues", { ...issuesPayload(31), repository: { name: "yok", owner: { login: GH_ORG } } })).status,
    ).toBe("ignored");
    expect(await db.select().from(githubOutbox)).toHaveLength(0);
  });

  it("başka alanın ticket'ının aynı numaralı issue'su karışmaz", async () => {
    const c = await world();
    await ticketWithIssue(c);
    const other = await makeTicketRow({ areaId: c.areaB.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "available", githubIssueNumber: 77 });
    await db.delete(githubOutbox);
    expect((await send("issues", issuesPayload(77))).status).toBe("ignored");
    expect((await db.select().from(githubOutbox)).some((r) => r.ticketId === other.id)).toBe(false);
  });
});
