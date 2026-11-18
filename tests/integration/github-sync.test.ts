import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  areas,
  githubMilestones,
  githubOutbox,
  sprints,
  submissions,
  ticketDependencies,
  ticketPullRequests,
  tickets,
  user,
} from "../../src/db/schema";
import { DEFAULT_SETTINGS } from "../../src/lib/contracts/settings";
import { getSettings } from "../../src/lib/settings";
import { __resetGithubAppForTests } from "../../src/server/github/app";
import { retryGithubSync, setAreaRepo } from "../../src/server/github/admin";
import { processGithubOutbox } from "../../src/server/github/outbox";
import { __resetGithubSyncCacheForTests, reconcileTicket } from "../../src/server/github/sync";
import { getTicketGithubView } from "../../src/server/github/view";
import { readFileForActor, storeUpload, submitTicket } from "../../src/server/delivery";
import { updateSettings } from "../../src/server/settings-admin";
import { getTicketDetail } from "../../src/server/ticket-view";
import { db, makeActor, makeUser, resetDb } from "../helpers/db";
import { H, T0, at, setupCycle, takenTicket, ticketById, type Cycle } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import {
  GH_BOT_LOGIN,
  GH_ORG,
  createFakeGithub,
  enableGithubEnv,
  disableGithubEnv,
  restoreGithubEnv,
  type FakeGithub,
} from "../helpers/fake-github";
import { auditRows, makeTicketRow } from "../helpers/plan";

let fake: FakeGithub;
let uploadDir: string;
const prevUploadDir = process.env.UPLOAD_DIR;

beforeAll(() => {
  uploadDir = mkdtempSync(path.join(tmpdir(), "sector7-gh-upl-"));
  process.env.UPLOAD_DIR = uploadDir;
});
afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
  if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = prevUploadDir;
});

beforeEach(async () => {
  await resetDb();
  enableGithubEnv();
  __resetGithubAppForTests();
  __resetGithubSyncCacheForTests();
  fake = createFakeGithub();
});
afterEach(() => {
  fake.restore();
  restoreGithubEnv();
});

/* ------------------------------ yardımcılar ------------------------------ */

/** Döngü + areaA'ya depo bağlanmış (ve sahte GitHub'da açılmış) dünya. */
async function world(repo: string | null = "repo-a", repoOpts: { defaultBranch?: string; sha?: string } = {}) {
  const c = await setupCycle();
  if (repo) {
    await db.update(areas).set({ githubRepo: repo }).where(eq(areas.id, c.areaA.id));
    fake.addRepo(repo, repoOpts);
  }
  return c;
}

const newTicket = (c: Cycle, over: Partial<typeof tickets.$inferInsert> = {}) =>
  makeTicketRow({
    areaId: c.areaA.id,
    sprintId: c.sprint.id,
    createdById: c.admin.id,
    status: "available",
    title: "Ana Sayfa Hero",
    description: "Hero bölümünü yap",
    ...over,
  });

const outboxRows = () => db.select().from(githubOutbox);
const outboxOf = async (id: string) => (await db.select().from(githubOutbox).where(eq(githubOutbox.ticketId, id)))[0];
const clearOutbox = () => db.delete(githubOutbox);
const shortOf = (id: string) => id.replace(/-/g, "").slice(0, 8);
const soon = () => new Date(Date.now() + 2000);
const enqueueSql = (id: string) => db.execute(sql`select github_outbox_enqueue(${id}::uuid)`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ 1. tetikleyiciler ------------------------------ */

describe("tetikleyiciler: github_outbox", () => {
  it("ticket insert edilince kuyruğa satır düşer (taslak dahil)", async () => {
    const c = await world();
    const t = await newTicket(c, { status: "draft" });
    const row = await outboxOf(t.id);
    expect(row).toBeDefined();
    expect(row!.attempts).toBe(0);
    expect(row!.lastError).toBeNull();
  });

  it("status, assignee, sprint, title, description değişimi kuyruğa ekler", async () => {
    const c = await world();
    const sprint2 = (await db.insert(sprints).values({ number: 2, name: "Sprint 2", startDate: "2026-12-01", lengthDays: 21 }).returning())[0]!;
    const t = await newTicket(c);
    const cases: [string, () => Promise<unknown>][] = [
      ["status", () => db.update(tickets).set({ status: "cancelled" }).where(eq(tickets.id, t.id))],
      ["assignee", () => db.update(tickets).set({ assigneeId: c.member.id }).where(eq(tickets.id, t.id))],
      ["sprint", () => db.update(tickets).set({ sprintId: sprint2.id }).where(eq(tickets.id, t.id))],
      ["title", () => db.update(tickets).set({ title: "Yeni başlık" }).where(eq(tickets.id, t.id))],
      ["description", () => db.update(tickets).set({ description: "Yeni açıklama" }).where(eq(tickets.id, t.id))],
    ];
    for (const [name, run] of cases) {
      await clearOutbox();
      await run();
      expect(await outboxOf(t.id), `${name} değişimi kuyruğa girmeli`).toBeDefined();
    }
  });

  it("ön koşul eklenince ve silinince kuyruğa girer (bağımlı olan ticket için)", async () => {
    const c = await world();
    const t = await newTicket(c);
    const dep = await newTicket(c, { title: "Önce bu" });
    await clearOutbox();
    await db.insert(ticketDependencies).values({ ticketId: t.id, dependsOnId: dep.id });
    expect(await outboxOf(t.id)).toBeDefined();
    expect(await outboxOf(dep.id)).toBeUndefined();
    await clearOutbox();
    await db.delete(ticketDependencies).where(eq(ticketDependencies.ticketId, t.id));
    expect(await outboxOf(t.id)).toBeDefined();
  });

  it("yalnız pos_x/pos_y ya da github_issue_number değişimi kuyruğa EKLEMEZ", async () => {
    const c = await world();
    const t = await newTicket(c);
    await clearOutbox();
    await db.update(tickets).set({ posX: 10, posY: 20 }).where(eq(tickets.id, t.id));
    await db.update(tickets).set({ githubIssueNumber: 5, githubIssueUrl: "https://x", githubBranch: "b" }).where(eq(tickets.id, t.id));
    expect(await outboxRows()).toHaveLength(0);
  });

  it("aynı değer yazmak (değişiklik yok) kuyruğa eklemez", async () => {
    const c = await world();
    const t = await newTicket(c);
    await clearOutbox();
    await db.update(tickets).set({ title: t.title, status: t.status }).where(eq(tickets.id, t.id));
    expect(await outboxRows()).toHaveLength(0);
  });

  it("tekrar eden değişiklik tek satırda birleşir; enqueued_at tazelenir, sayaç ve hata sıfırlanır", async () => {
    const c = await world();
    const t = await newTicket(c);
    await db.update(githubOutbox).set({ attempts: 3, lastError: "eski hata" }).where(eq(githubOutbox.ticketId, t.id));
    const first = (await outboxOf(t.id))!;
    await sleep(20);
    await db.update(tickets).set({ title: "Başka" }).where(eq(tickets.id, t.id));
    await db.update(tickets).set({ title: "Bir daha" }).where(eq(tickets.id, t.id));
    const rows = (await outboxRows()).filter((r) => r.ticketId === t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enqueuedAt.getTime()).toBeGreaterThan(first.enqueuedAt.getTime());
    expect(rows[0]!.attempts).toBe(0);
    expect(rows[0]!.lastError).toBeNull();
  });
});

/* ------------------------------ 2. processGithubOutbox ------------------------------ */

describe("processGithubOutbox", () => {
  it("senkron kapalıyken satırlar silinir (dropped) ve hiç ağ çağrısı yapılmaz", async () => {
    const c = await world();
    await newTicket(c);
    await newTicket(c, { title: "İkinci" });
    expect(await outboxRows()).toHaveLength(2);
    disableGithubEnv();
    const r = await processGithubOutbox(db, { now: soon() });
    expect(r).toEqual({ processed: 0, failed: 0, dropped: 2 });
    expect(await outboxRows()).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });

  it("eksik tek ortam değişkeni de senkronu kapatır", async () => {
    const c = await world();
    await newTicket(c);
    enableGithubEnv({ GITHUB_WEBHOOK_SECRET: undefined });
    const r = await processGithubOutbox(db, { now: soon() });
    expect(r.dropped).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });

  it("açıkken başarılı işlenen satır silinir ve issue açılır", async () => {
    const c = await world();
    const t = await newTicket(c);
    const r = await processGithubOutbox(db, { now: soon() });
    expect(r).toEqual({ processed: 1, failed: 0, dropped: 0 });
    expect(await outboxRows()).toHaveLength(0);
    expect((await ticketById(t.id)).githubIssueNumber).toBe(1);
  });

  it("deposuz alandaki ve taslak ticket'ın satırı da işlenip silinir; çağrı yapılmaz", async () => {
    const c = await world(null);
    await newTicket(c);
    const r = await processGithubOutbox(db, { now: soon() });
    expect(r.processed).toBe(1);
    expect(await outboxRows()).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });

  it("işleme sırasında tazelenen satır silinmez", async () => {
    const c = await world();
    const t = await newTicket(c);
    let fired = false;
    fake.state.beforeRequest = async (call) => {
      if (!fired && call.method === "POST" && /\/issues$/.test(call.path)) {
        fired = true;
        await sleep(5);
        await enqueueSql(t.id);
      }
    };
    const r = await processGithubOutbox(db, { now: soon() });
    expect(fired).toBe(true);
    expect(r.processed).toBe(1);
    const row = await outboxOf(t.id);
    expect(row, "tazelenen satır kalmalı").toBeDefined();
    // Sonraki turda işlenir ve silinir.
    fake.state.beforeRequest = undefined;
    await processGithubOutbox(db, { now: soon() });
    expect(await outboxRows()).toHaveLength(0);
  });

  it("hata: attempts artar, next_attempt_at ileri gider (üstel), last_error dolar", async () => {
    const c = await world();
    const t = await newTicket(c);
    fake.failWith((x) => x.method === "POST" && /\/issues$/.test(x.path), 500, "boom");
    const now1 = soon();
    const r1 = await processGithubOutbox(db, { now: now1 });
    expect(r1).toMatchObject({ processed: 0, failed: 1 });
    const a = (await outboxOf(t.id))!;
    expect(a.attempts).toBe(1);
    expect(a.lastError).toContain("boom");
    expect(a.nextAttemptAt.getTime()).toBe(now1.getTime() + 60_000);

    // Geri çekilme dolmadan işlenmez.
    const r2 = await processGithubOutbox(db, { now: new Date(now1.getTime() + 30_000) });
    expect(r2).toEqual({ processed: 0, failed: 0, dropped: 0 });

    const now3 = new Date(now1.getTime() + 61_000);
    await processGithubOutbox(db, { now: now3 });
    const b = (await outboxOf(t.id))!;
    expect(b.attempts).toBe(2);
    expect(b.nextAttemptAt.getTime()).toBe(now3.getTime() + 120_000);
  });

  it("hata metni kişisel veri (başlık, açıklama, ad, kullanıcı adı, e-posta) içermez", async () => {
    const c = await world();
    const person = await makeUser({ name: "Ayşe Gizliyılmaz", githubLogin: "gizli-login", email: "ayse.gizli@example.com" });
    const t = await newTicket(c, {
      title: "Mahrem Başlık",
      description: "Gizli açıklama metni",
      status: "taken",
      assigneeId: person.id,
    });
    const secrets = ["Mahrem Başlık", "Gizli açıklama", "Gizliyılmaz", "gizli-login", "ayse.gizli"];

    // 1) Ağ hatası; hata metni kişisel veri taşısa bile kuyruğa yazılmaz.
    fake.state.networkError = "bağlantı koptu Mahrem Başlık gizli-login ayse.gizli@example.com";
    await processGithubOutbox(db, { now: soon() });
    let err = (await outboxOf(t.id))!.lastError ?? "";
    expect(err).not.toBe("");
    for (const s of secrets) expect(err).not.toContain(s);

    // 2) GitHub 422 yanıtı.
    fake.state.networkError = null;
    await enqueueSql(t.id);
    fake.failWith(() => true, 422, "Validation Failed");
    await processGithubOutbox(db, { now: soon() });
    err = (await outboxOf(t.id))!.lastError ?? "";
    expect(err).toContain("Validation Failed");
    for (const s of secrets) expect(err).not.toContain(s);
    expect(err.length).toBeLessThanOrEqual(200);
  });

  it("eşzamanlı işleyiciler aynı ticket'ı iki kez işlemez (SKIP LOCKED)", async () => {
    const c = await world();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push((await newTicket(c, { title: `İş ${i}` })).id);
    fake.state.latencyMs = 8;
    const results = await Promise.all([
      processGithubOutbox(db, { now: soon() }),
      processGithubOutbox(db, { now: soon() }),
      processGithubOutbox(db, { now: soon() }),
      processGithubOutbox(db, { now: soon() }),
    ]);
    expect(results.reduce((n, r) => n + r.processed, 0)).toBe(8);
    expect(results.reduce((n, r) => n + r.failed, 0)).toBe(0);
    const issues = fake.repo("repo-a").issues;
    expect(issues).toHaveLength(8);
    for (const id of ids) {
      expect(issues.filter((i) => i.body?.includes(`<!-- sector7:ticket:${id} -->`))).toHaveLength(1);
    }
    expect(await outboxRows()).toHaveLength(0);
  });

  it("limit ile bölünen iki işleyici toplamda her ticket'ı bir kez işler", async () => {
    const c = await world();
    for (let i = 0; i < 6; i++) await newTicket(c, { title: `İş ${i}` });
    fake.state.latencyMs = 8;
    const [a, b] = await Promise.all([
      processGithubOutbox(db, { now: soon(), limit: 3 }),
      processGithubOutbox(db, { now: soon(), limit: 3 }),
    ]);
    expect(a.processed + b.processed).toBe(6);
    expect(fake.callsTo("POST", /\/issues$/)).toHaveLength(6);
  });
});

/* ------------------------------ 3. reconcileTicket ------------------------------ */

describe("reconcileTicket", () => {
  it("taslak ticket'ta API çağrısı yapılmaz", async () => {
    const c = await world();
    const t = await newTicket(c, { status: "draft" });
    await reconcileTicket(db, t.id);
    expect(fake.calls).toHaveLength(0);
    expect((await ticketById(t.id)).githubIssueNumber).toBeNull();
  });

  it("deposuz alanda API çağrısı yapılmaz", async () => {
    const c = await world(null);
    const t = await newTicket(c);
    await reconcileTicket(db, t.id);
    expect(fake.calls).toHaveLength(0);
  });

  it("yayınlanan ticket için issue açılır: başlık, gövde, ön koşullar, işaretçi, etiket, milestone", async () => {
    const c = await world();
    const t = await newTicket(c, { title: "Hero bölümü", description: "Detaylı açıklama" });
    const sameRepoDep = await newTicket(c, { title: "Önce A" });
    await db.update(tickets).set({ githubIssueNumber: 77, githubIssueUrl: "https://x/77" }).where(eq(tickets.id, sameRepoDep.id));
    const otherDep = await makeTicketRow({
      areaId: c.areaB.id,
      sprintId: c.sprint.id,
      createdById: c.admin.id,
      status: "available",
      title: "Başka alan işi",
    });
    await db.insert(ticketDependencies).values([
      { ticketId: t.id, dependsOnId: sameRepoDep.id },
      { ticketId: t.id, dependsOnId: otherDep.id },
    ]);

    await reconcileTicket(db, t.id);

    const issue = fake.repo("repo-a").issues[0]!;
    expect(fake.repo("repo-a").issues).toHaveLength(1);
    expect(issue.title).toBe("Hero bölümü");
    expect(issue.body).toContain("Detaylı açıklama");
    expect(issue.body).toContain("- #77");
    expect(issue.body).toContain(`${c.areaB.name} · Başka alan işi`);
    expect(issue.body).toContain(`<!-- sector7:ticket:${t.id} -->`);
    expect(issue.labels.map((l) => l.name)).toEqual(["sprint-01"]);
    expect(fake.repo("repo-a").labels.has("sprint-01")).toBe(true);
    const ms = fake.repo("repo-a").milestones;
    expect(ms.map((m) => m.title)).toEqual(["Sprint 1"]);
    expect(issue.milestone).toBe(ms[0]!.number);
    expect(issue.state).toBe("open");

    const row = await ticketById(t.id);
    expect(row.githubIssueNumber).toBe(issue.number);
    expect(row.githubIssueUrl).toBe(issue.html_url);
    const cache = await db.select().from(githubMilestones);
    expect(cache).toEqual([{ repo: "repo-a", sprintId: c.sprint.id, number: ms[0]!.number }]);
  });

  it("var olan etiket/milestone yeniden oluşturulmaz; milestone önbellekten okunur", async () => {
    const c = await world();
    fake.repo("repo-a").labels.add("sprint-01");
    fake.repo("repo-a").milestones.push({ number: 9, title: "Sprint 1" });
    fake.repo("repo-a").nextMilestone = 10;
    const t = await newTicket(c);
    await reconcileTicket(db, t.id);
    expect(fake.callsTo("POST", /\/labels$/)).toHaveLength(0);
    expect(fake.callsTo("POST", /\/milestones$/)).toHaveLength(0);
    expect(fake.repo("repo-a").issues[0]!.milestone).toBe(9);
    expect((await db.select().from(githubMilestones))[0]!.number).toBe(9);

    __resetGithubSyncCacheForTests();
    fake.resetCalls();
    await reconcileTicket(db, t.id);
    expect(fake.callsTo("GET", /\/milestones$/)).toHaveLength(0);
  });

  it("ikinci reconcile yeni issue AÇMAZ (idempotent); mevcut issue güncellenir", async () => {
    const c = await world();
    const t = await newTicket(c);
    await reconcileTicket(db, t.id);
    await db.update(tickets).set({ title: "Güncel başlık" }).where(eq(tickets.id, t.id));
    await reconcileTicket(db, t.id);
    await reconcileTicket(db, t.id);
    expect(fake.repo("repo-a").issues).toHaveLength(1);
    expect(fake.repo("repo-a").issues[0]!.title).toBe("Güncel başlık");
    expect(fake.callsTo("POST", /\/issues$/)).toHaveLength(1);
  });

  it("işaretçi koruması: numara DB'ye yazılmamışsa yeniden çalıştırma mevcut issue'yu bağlar", async () => {
    const c = await world();
    const t = await newTicket(c);
    await reconcileTicket(db, t.id);
    const issue = fake.repo("repo-a").issues[0]!;
    // Yazma kaybı: issue GitHub'da var, DB'de numara yok.
    await db.update(tickets).set({ githubIssueNumber: null, githubIssueUrl: null }).where(eq(tickets.id, t.id));
    await reconcileTicket(db, t.id);
    expect(fake.repo("repo-a").issues).toHaveLength(1);
    const row = await ticketById(t.id);
    expect(row.githubIssueNumber).toBe(issue.number);
    expect(row.githubIssueUrl).toBe(issue.html_url);
  });

  it("işaretçi başka bir ticket'a aitse bağlanmaz (iki ticket iki issue)", async () => {
    const c = await world();
    const t1 = await newTicket(c, { title: "Bir" });
    const t2 = await newTicket(c, { title: "İki" });
    await reconcileTicket(db, t1.id);
    await reconcileTicket(db, t2.id);
    expect(fake.repo("repo-a").issues).toHaveLength(2);
    expect((await ticketById(t1.id)).githubIssueNumber).not.toBe((await ticketById(t2.id)).githubIssueNumber);
  });

  it("GitHub'da silinmiş issue (404) yeniden açılır", async () => {
    const c = await world();
    const t = await newTicket(c);
    await db.update(tickets).set({ githubIssueNumber: 99, githubIssueUrl: "https://x/99" }).where(eq(tickets.id, t.id));
    await reconcileTicket(db, t.id);
    const row = await ticketById(t.id);
    expect(row.githubIssueNumber).toBe(fake.repo("repo-a").issues[0]!.number);
    expect(row.githubIssueNumber).not.toBe(99);
  });

  it("kabul edilince (taken): kişi atanır, varsayılan dalın SHA'sından iş dalı açılır ve yazılır", async () => {
    const sha = "c".repeat(40);
    const c = await world("repo-a", { defaultBranch: "trunk", sha });
    await db.update(user).set({ githubLogin: "octocat" }).where(eq(user.id, c.member.id));
    const t = await takenTicket(c, c.areaA.id, c.member, { title: "Ana Sayfa Hero", description: "d" });
    await reconcileTicket(db, t.id);

    const issue = fake.repo("repo-a").issues[0]!;
    expect(issue.assignees).toEqual(["octocat"]);
    const branch = `sprint-01/${shortOf(t.id)}-ana-sayfa-hero`;
    expect(fake.repo("repo-a").refs.get(`refs/heads/${branch}`)).toBe(sha);
    expect((await ticketById(t.id)).githubBranch).toBe(branch);
  });

  it("dal adı Türkçe karakterleri sadeleştirir", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member, { title: "Çağrı Şablonu: İçerik/Öğe!" });
    await reconcileTicket(db, t.id);
    const branch = (await ticketById(t.id)).githubBranch!;
    expect(branch).toBe(`sprint-01/${shortOf(t.id)}-cagri-sablonu-icerik-oge`);
  });

  it("GitHub kullanıcı adı olmayan kişi atanmaz (atanan boş)", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await reconcileTicket(db, t.id);
    expect(fake.repo("repo-a").issues[0]!.assignees).toEqual([]);
  });

  it("havuza dönünce atanan [] olur, dal silinmez; ikinci reconcile dalı tekrar açmaz", async () => {
    const c = await world();
    await db.update(user).set({ githubLogin: "octocat" }).where(eq(user.id, c.member.id));
    const t = await takenTicket(c, c.areaA.id, c.member);
    await reconcileTicket(db, t.id);
    const branch = (await ticketById(t.id)).githubBranch!;
    expect(branch).toBeTruthy();

    await db
      .update(tickets)
      .set({ status: "available", assigneeId: null, takenAt: null, dueAt: null })
      .where(eq(tickets.id, t.id));
    fake.resetCalls();
    await reconcileTicket(db, t.id);
    expect(fake.repo("repo-a").issues[0]!.assignees).toEqual([]);
    expect(fake.repo("repo-a").refs.has(`refs/heads/${branch}`)).toBe(true);
    expect((await ticketById(t.id)).githubBranch).toBe(branch);
    expect(fake.calls.filter((x) => x.method === "DELETE")).toHaveLength(0);

    // Başka kişi alınca aynı dal korunur, yeniden açılmaz.
    await db.update(tickets).set({ status: "taken", assigneeId: c.member.id }).where(eq(tickets.id, t.id));
    fake.resetCalls();
    await reconcileTicket(db, t.id);
    expect(fake.callsTo("POST", /\/git\/refs$/)).toHaveLength(0);
  });

  it("cancelled → kapalı (not_planned); evaluated → kapalı (completed)", async () => {
    const c = await world();
    const a = await newTicket(c, { title: "A" });
    const b = await newTicket(c, { title: "B" });
    await reconcileTicket(db, a.id);
    await reconcileTicket(db, b.id);
    await db.update(tickets).set({ status: "cancelled" }).where(eq(tickets.id, a.id));
    await db.update(tickets).set({ status: "evaluated" }).where(eq(tickets.id, b.id));
    await reconcileTicket(db, a.id);
    await reconcileTicket(db, b.id);
    const issues = fake.repo("repo-a").issues;
    const ia = issues.find((i) => i.title === "A")!;
    const ib = issues.find((i) => i.title === "B")!;
    expect([ia.state, ia.state_reason]).toEqual(["closed", "not_planned"]);
    expect([ib.state, ib.state_reason]).toEqual(["closed", "completed"]);
  });

  it("ilk kez sync edilen iptal ticket'ı için issue açılır ve hemen kapatılır", async () => {
    const c = await world();
    const t = await newTicket(c, { status: "cancelled" });
    await reconcileTicket(db, t.id);
    const i = fake.repo("repo-a").issues[0]!;
    expect([i.state, i.state_reason]).toEqual(["closed", "not_planned"]);
  });

  it("GitHub'da elle kapatılmış açık ticket yeniden açılır", async () => {
    const c = await world();
    const t = await newTicket(c);
    await reconcileTicket(db, t.id);
    const issue = fake.repo("repo-a").issues[0]!;
    issue.state = "closed";
    issue.state_reason = "completed";
    await reconcileTicket(db, t.id);
    expect(issue.state).toBe("open");
  });

  it("elle eklenmiş başka etiketler korunur; eski sprint etiketi yenisiyle değişir", async () => {
    const c = await world();
    const sprint2 = (await db.insert(sprints).values({ number: 2, name: "Sprint 2", startDate: "2026-12-01", lengthDays: 21 }).returning())[0]!;
    const t = await newTicket(c);
    await reconcileTicket(db, t.id);
    const issue = fake.repo("repo-a").issues[0]!;
    issue.labels.push({ name: "bug" }, { name: "iyi-ilk-is" });
    await reconcileTicket(db, t.id);
    expect(issue.labels.map((l) => l.name).sort()).toEqual(["bug", "iyi-ilk-is", "sprint-01"]);

    await db.update(tickets).set({ sprintId: sprint2.id }).where(eq(tickets.id, t.id));
    await reconcileTicket(db, t.id);
    expect(issue.labels.map((l) => l.name).sort()).toEqual(["bug", "iyi-ilk-is", "sprint-02"]);
    expect(fake.repo("repo-a").milestones.map((m) => m.title)).toEqual(["Sprint 1", "Sprint 2"]);
  });

  it("milestone GitHub'da silinmişse (422) önbellek yenilenip bir kez daha denenir", async () => {
    const c = await world();
    const t = await newTicket(c);
    await reconcileTicket(db, t.id);
    // Milestone GitHub'dan silindi; önbellekte eski numara duruyor.
    fake.repo("repo-a").milestones.length = 0;
    await db.update(tickets).set({ title: "Güncellendi" }).where(eq(tickets.id, t.id));
    await reconcileTicket(db, t.id);
    const issue = fake.repo("repo-a").issues[0]!;
    expect(issue.title).toBe("Güncellendi");
    expect(fake.repo("repo-a").milestones).toHaveLength(1);
    expect(issue.milestone).toBe(fake.repo("repo-a").milestones[0]!.number);
  });

  it("issue'yu başka bir bot/kişi açtıysa işaretçi eşleşmesi kullanılmaz", async () => {
    const c = await world();
    const t = await newTicket(c);
    fake.repo("repo-a").labels.add("sprint-01");
    fake.seedIssue("repo-a", {
      title: "Sahte",
      body: `<!-- sector7:ticket:${t.id} -->`,
      labels: [{ name: "sprint-01" }],
      creator: "someone-else",
    });
    await reconcileTicket(db, t.id);
    expect(fake.repo("repo-a").issues).toHaveLength(2);
    expect(fake.repo("repo-a").issues[1]!.creator).toBe(GH_BOT_LOGIN);
  });
});

/* ------------------------------ 4. setAreaRepo ------------------------------ */

describe("setAreaRepo", () => {
  it("yalnız ana yönetici yapabilir; alan yöneticisi ve üye FORBIDDEN, oturumsuz UNAUTHENTICATED", async () => {
    const c = await setupCycle();
    const input = { areaId: c.areaA.id, repo: "repo-a" };
    await expectCode(setAreaRepo(db, null, input), "UNAUTHENTICATED");
    await expectCode(setAreaRepo(db, c.mgrA, input), "FORBIDDEN");
    await expectCode(setAreaRepo(db, c.member, input), "FORBIDDEN");
    const [a] = await db.select().from(areas).where(eq(areas.id, c.areaA.id));
    expect(a!.githubRepo).toBeNull();
    expect(await auditRows("github.area_repo")).toHaveLength(0);

    await setAreaRepo(db, c.admin, input);
    const [a2] = await db.select().from(areas).where(eq(areas.id, c.areaA.id));
    expect(a2!.githubRepo).toBe("repo-a");
  });

  it("geçersiz depo adı reddedilir", async () => {
    const c = await setupCycle();
    for (const repo of ["a/b", "bir iki", "..", "x".repeat(101)]) {
      await expect(setAreaRepo(db, c.admin, { areaId: c.areaA.id, repo })).rejects.toBeDefined();
    }
  });

  it("aynı depo iki alana atanamaz (harf duyarsız) → CONFLICT; kendi alanında tekrar serbest", async () => {
    const c = await setupCycle();
    await setAreaRepo(db, c.admin, { areaId: c.areaA.id, repo: "Repo-X" });
    await expectCode(setAreaRepo(db, c.admin, { areaId: c.areaB.id, repo: "repo-x" }), "CONFLICT");
    await expectCode(setAreaRepo(db, c.admin, { areaId: c.areaB.id, repo: "REPO-X" }), "CONFLICT");
    const [b] = await db.select().from(areas).where(eq(areas.id, c.areaB.id));
    expect(b!.githubRepo).toBeNull();
    // Kendi alanında harf değişimi (çakışma yok).
    await setAreaRepo(db, c.admin, { areaId: c.areaA.id, repo: "repo-x" });
    const [a] = await db.select().from(areas).where(eq(areas.id, c.areaA.id));
    expect(a!.githubRepo).toBe("repo-x");
  });

  it("eşzamanlı iki atama: aynı depoya yalnız biri başarılı olur", async () => {
    const c = await setupCycle();
    const res = await Promise.allSettled([
      setAreaRepo(db, c.admin, { areaId: c.areaA.id, repo: "ortak" }),
      setAreaRepo(db, c.admin, { areaId: c.areaB.id, repo: "Ortak" }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CONFLICT" });
    const rows = await db.select().from(areas);
    expect(rows.filter((a) => a.githubRepo?.toLowerCase() === "ortak")).toHaveLength(1);
  });

  it("depo değişince issue/dal alanları sıfırlanır ve draft dışı ticket'lar kuyruğa girer; denetim kaydı yazılır", async () => {
    const c = await world("repo-a");
    const draft = await newTicket(c, { status: "draft", title: "Taslak" });
    const avail = await newTicket(c, { title: "Havuz" });
    const taken = await takenTicket(c, c.areaA.id, c.member, { title: "Alınmış" });
    const other = await makeTicketRow({ areaId: c.areaB.id, sprintId: c.sprint.id, createdById: c.admin.id, status: "available" });
    for (const t of [draft, avail, taken, other]) {
      await db
        .update(tickets)
        .set({ githubIssueNumber: 5, githubIssueUrl: "https://x/5", githubBranch: "sprint-01/x" })
        .where(eq(tickets.id, t.id));
    }
    await clearOutbox();

    await setAreaRepo(db, c.admin, { areaId: c.areaA.id, repo: "repo-new" });

    for (const t of [draft, avail, taken]) {
      const row = await ticketById(t.id);
      expect([row.githubIssueNumber, row.githubIssueUrl, row.githubBranch], t.title).toEqual([null, null, null]);
    }
    const o = await ticketById(other.id);
    expect(o.githubIssueNumber).toBe(5);

    const queued = (await outboxRows()).map((r) => r.ticketId).sort();
    expect(queued).toEqual([avail.id, taken.id].sort());

    const log = await auditRows("github.area_repo", c.areaA.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: c.admin.id, areaId: c.areaA.id, entityType: "area" });
    expect(log[0]!.data).toEqual({ from: "repo-a", to: "repo-new" });
  });

  it("depo değişmediyse hiçbir şey yapılmaz (kuyruk ve denetim boş)", async () => {
    const c = await world("repo-a");
    await newTicket(c);
    await clearOutbox();
    await setAreaRepo(db, c.admin, { areaId: c.areaA.id, repo: "repo-a" });
    expect(await outboxRows()).toHaveLength(0);
    expect(await auditRows("github.area_repo")).toHaveLength(0);
  });

  it("boş depo = senkron dışı; yazılan değer null", async () => {
    const c = await world("repo-a");
    await setAreaRepo(db, c.admin, { areaId: c.areaA.id, repo: "" });
    const [a] = await db.select().from(areas).where(eq(areas.id, c.areaA.id));
    expect(a!.githubRepo).toBeNull();
    expect((await auditRows("github.area_repo"))[0]!.data).toEqual({ from: "repo-a", to: null });
  });

  it("olmayan alan NOT_FOUND", async () => {
    const c = await setupCycle();
    await expectCode(setAreaRepo(db, c.admin, { areaId: "00000000-0000-4000-8000-000000000000", repo: "x" }), "NOT_FOUND");
  });
});

/* ------------------------------ 5. retryGithubSync ------------------------------ */

describe("retryGithubSync", () => {
  it("alan yöneticisi ve ana yönetici yapabilir: ticket kuyruğa girer, sayaç sıfırlanır, denetim yazılır", async () => {
    const c = await world();
    const t = await newTicket(c);
    for (const [actor, n] of [
      [c.mgrA, 1],
      [c.admin, 2],
    ] as const) {
      await db.update(githubOutbox).set({ attempts: 4, lastError: "hata" }).where(eq(githubOutbox.ticketId, t.id));
      await clearOutbox();
      await retryGithubSync(db, actor, { ticketId: t.id });
      const row = await outboxOf(t.id);
      expect(row).toBeDefined();
      expect(row!.attempts).toBe(0);
      expect(row!.lastError).toBeNull();
      expect(await auditRows("github.sync_retry", t.id)).toHaveLength(n);
    }
    const log = (await auditRows("github.sync_retry", t.id))[0]!;
    expect(log).toMatchObject({ entityType: "ticket", areaId: c.areaA.id, ticketId: t.id });
  });

  it("başarısız (bekleyen) satırı sıfırlar; sonraki işleme geçer", async () => {
    const c = await world();
    const t = await newTicket(c);
    await db
      .update(githubOutbox)
      .set({ attempts: 5, lastError: "GitHub 500", nextAttemptAt: new Date(Date.now() + 3600_000) })
      .where(eq(githubOutbox.ticketId, t.id));
    await retryGithubSync(db, c.mgrA, { ticketId: t.id });
    const r = await processGithubOutbox(db, { now: soon() });
    expect(r.processed).toBe(1);
  });

  it("başka alanın yöneticisi, üye (ticket sahibi dahil) ve oturumsuz yapamaz", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await clearOutbox();
    await expectCode(retryGithubSync(db, c.mgrB, { ticketId: t.id }), "FORBIDDEN");
    await expectCode(retryGithubSync(db, c.member, { ticketId: t.id }), "FORBIDDEN");
    await expectCode(retryGithubSync(db, null, { ticketId: t.id }), "UNAUTHENTICATED");
    expect(await outboxRows()).toHaveLength(0);
    expect(await auditRows("github.sync_retry")).toHaveLength(0);
  });

  it("olmayan ticket NOT_FOUND", async () => {
    const c = await setupCycle();
    await expectCode(retryGithubSync(db, c.admin, { ticketId: "00000000-0000-4000-8000-000000000000" }), "NOT_FOUND");
  });
});

/* ------------------------------ 6. getTicketGithubView ------------------------------ */

describe("getTicketGithubView", () => {
  it("senkron kapalıyken null", async () => {
    const c = await world();
    const t = await newTicket(c);
    disableGithubEnv();
    expect(await getTicketGithubView(db, c.admin, t.id)).toBeNull();
  });

  it("alanın deposu yoksa null", async () => {
    const c = await world(null);
    const t = await newTicket(c);
    expect(await getTicketGithubView(db, c.admin, t.id)).toBeNull();
  });

  it("oturumsuz ve olmayan ticket için null", async () => {
    const c = await world();
    const t = await newTicket(c);
    expect(await getTicketGithubView(db, null, t.id)).toBeNull();
    expect(await getTicketGithubView(db, c.admin, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("ticket'ı göremeyen kişi null alır; assignee, alan yöneticisi ve ana yönetici görür", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const stranger = await makeActor({ homeAreaId: c.home.id });
    expect(await getTicketGithubView(db, stranger, t.id)).toBeNull();
    expect(await getTicketGithubView(db, c.mgrB, t.id)).toBeNull();
    for (const a of [c.member, c.mgrA, c.admin]) {
      expect(await getTicketGithubView(db, a, t.id)).not.toBeNull();
    }
  });

  it("syncError ve syncPending yalnız yöneticiye görünür", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await db.update(githubOutbox).set({ lastError: "GitHub 500: boom" }).where(eq(githubOutbox.ticketId, t.id));
    const asMember = (await getTicketGithubView(db, c.member, t.id))!;
    expect(asMember.syncError).toBeNull();
    expect(asMember.syncPending).toBe(false);
    for (const a of [c.mgrA, c.admin]) {
      const v = (await getTicketGithubView(db, a, t.id))!;
      expect(v.syncError).toBe("GitHub 500: boom");
      expect(v.syncPending).toBe(true);
    }
    await clearOutbox();
    const v = (await getTicketGithubView(db, c.mgrA, t.id))!;
    expect(v).toMatchObject({ syncError: null, syncPending: false });
  });

  it("birleşmiş PR varsa readyToSubmit true; yoksa ya da yalnız açık PR varsa false", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    expect((await getTicketGithubView(db, c.member, t.id))!.readyToSubmit).toBe(false);
    const url = (n: number) => `https://github.com/${GH_ORG}/repo-a/pull/${n}`;
    await db.insert(ticketPullRequests).values({ ticketId: t.id, repo: "repo-a", number: 1, url: url(1), title: "Açık", state: "open", merged: false });
    expect((await getTicketGithubView(db, c.member, t.id))!.readyToSubmit).toBe(false);
    await db.insert(ticketPullRequests).values({ ticketId: t.id, repo: "repo-a", number: 2, url: url(2), title: "Kapalı, birleşmemiş", state: "closed", merged: false });
    expect((await getTicketGithubView(db, c.member, t.id))!.readyToSubmit).toBe(false);
    await db.insert(ticketPullRequests).values({ ticketId: t.id, repo: "repo-a", number: 3, url: url(3), title: "Birleşti", state: "closed", merged: true });
    const v = (await getTicketGithubView(db, c.member, t.id))!;
    expect(v.readyToSubmit).toBe(true);
    expect(v.pullRequests).toHaveLength(3);
    expect(v.pullRequests.find((p) => p.number === 3)).toMatchObject({ merged: true, state: "closed", title: "Birleşti" });
    // Başka ticket'ın PR'ı karışmaz.
    const other = await newTicket(c);
    expect((await getTicketGithubView(db, c.mgrA, other.id))!.pullRequests).toHaveLength(0);
  });

  it("branchUrl biçimi: https://github.com/<org>/<depo>/tree/<dal>; issueUrl ve branch geçer", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const v0 = (await getTicketGithubView(db, c.member, t.id))!;
    expect(v0).toMatchObject({ repo: "repo-a", branch: null, branchUrl: null, issueUrl: null });
    await db
      .update(tickets)
      .set({ githubBranch: "sprint-01/ab12cd34-ana-sayfa", githubIssueUrl: `https://github.com/${GH_ORG}/repo-a/issues/3` })
      .where(eq(tickets.id, t.id));
    const v = (await getTicketGithubView(db, c.member, t.id))!;
    expect(v.branch).toBe("sprint-01/ab12cd34-ana-sayfa");
    expect(v.branchUrl).toBe(`https://github.com/${GH_ORG}/repo-a/tree/sprint-01/ab12cd34-ana-sayfa`);
    expect(v.issueUrl).toBe(`https://github.com/${GH_ORG}/repo-a/issues/3`);
  });
});

/* ------------------------------ 8. teslim ------------------------------ */

const subIn = (ticketId: string, over: Record<string, unknown> = {}) => ({
  ticketId,
  description: "Yaptım ve bitirdim",
  links: [],
  fileIds: [],
  ...over,
});
const upload = (bytes = 10, name = "rapor.txt") => ({
  name,
  type: "text/plain",
  size: bytes,
  arrayBuffer: async () => new Uint8Array(bytes).fill(65).buffer as ArrayBuffer,
});
const prRow = (ticketId: string, number: number) =>
  db
    .insert(ticketPullRequests)
    .values({
      ticketId,
      repo: "repo-a",
      number,
      url: `https://github.com/${GH_ORG}/repo-a/pull/${number}`,
      title: `PR ${number}`,
      state: "closed",
      merged: true,
    })
    .returning()
    .then((r) => r[0]!);

describe("teslim: PR ve yükleme", () => {
  it("pullRequestId başka ticket'ın PR'ıysa reddedilir; teslim yazılmaz, durum değişmez", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const other = await newTicket(c, { title: "Başka" });
    const foreign = await prRow(other.id, 7);
    await expectCode(submitTicket(db, c.member, subIn(t.id, { pullRequestId: foreign.id }), at(H)), "INVALID_STATE");
    expect(await db.select().from(submissions)).toHaveLength(0);
    expect((await ticketById(t.id)).status).toBe("taken");
  });

  it("olmayan PR kimliği reddedilir", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await expectCode(
      submitTicket(db, c.member, subIn(t.id, { pullRequestId: "00000000-0000-4000-8000-000000000000" }), at(H)),
      "INVALID_STATE",
    );
  });

  it("kendi PR'ı kaydedilir; teslim görünümünde pullRequest dolu, PR'sız teslimde null", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const pr = await prRow(t.id, 8);
    await submitTicket(db, c.member, subIn(t.id, { description: "PR'sız ilk teslim" }), at(H));
    await submitTicket(db, c.member, subIn(t.id, { pullRequestId: pr.id }), at(2 * H));
    const rows = await db.select().from(submissions).where(eq(submissions.ticketId, t.id)).orderBy(asc(submissions.createdAt));
    expect(rows.map((r) => r.pullRequestId)).toEqual([null, pr.id]);

    const detail = await getTicketDetail(db, c.member, { ticketId: t.id }, at(3 * H));
    const withPr = detail.submissions.find((s) => s.id === rows[1]!.id)!;
    expect(withPr.pullRequest).toEqual({ number: 8, url: pr.url, title: "PR 8", merged: true });
    expect(detail.submissions.find((s) => s.id === rows[0]!.id)!.pullRequest).toBeNull();
    // Yönetici de görür.
    const asMgr = await getTicketDetail(db, c.mgrA, { ticketId: t.id }, at(3 * H));
    expect(asMgr.submissions.some((s) => s.pullRequest?.number === 8)).toBe(true);
  });

  it("PR olmadan teslim hâlâ olur (açıklama yine zorunlu)", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    await expect(submitTicket(db, c.member, subIn(t.id, { description: "a" }), at(H))).rejects.toBeDefined();
    await submitTicket(db, c.member, subIn(t.id), at(H));
    expect((await ticketById(t.id)).status).toBe("submitted");
  });

  it("uploadsEnabled=false iken storeUpload reddedilir ve açıkken kabul edilir", async () => {
    const c = await world();
    await storeUpload(db, c.member, upload(), T0);
    await updateSettings(db, c.admin, { ...DEFAULT_SETTINGS, uploadsEnabled: false });
    await expectCode(storeUpload(db, c.member, upload(), T0), "INVALID_STATE");
    await updateSettings(db, c.admin, { ...DEFAULT_SETTINGS, uploadsEnabled: true });
    await storeUpload(db, c.member, upload(), T0);
  });

  it("uploadsEnabled=false iken fileIds'li teslim reddedilir; dosyasız teslim olur", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const f = await storeUpload(db, c.member, upload(), T0);
    await updateSettings(db, c.admin, { ...DEFAULT_SETTINGS, uploadsEnabled: false });
    await expectCode(submitTicket(db, c.member, subIn(t.id, { fileIds: [f.id] }), at(H)), "VALIDATION");
    expect((await ticketById(t.id)).status).toBe("taken");
    expect(await db.select().from(submissions)).toHaveLength(0);
    await submitTicket(db, c.member, subIn(t.id, { links: ["https://example.com/pr"] }), at(H));
    expect((await ticketById(t.id)).status).toBe("submitted");
  });

  it("yükleme kapalıyken de mevcut dosyalar indirilebilir (sahip ve alan yöneticisi)", async () => {
    const c = await world();
    const t = await takenTicket(c, c.areaA.id, c.member);
    const f = await storeUpload(db, c.member, upload(12, "kanit.txt"), T0);
    await submitTicket(db, c.member, subIn(t.id, { fileIds: [f.id] }), at(H));
    await updateSettings(db, c.admin, { ...DEFAULT_SETTINGS, uploadsEnabled: false });
    for (const a of [c.member, c.mgrA]) {
      const r = await readFileForActor(db, a, f.id);
      expect(r).toMatchObject({ name: "kanit.txt", sizeBytes: 12 });
    }
    await expectCode(readFileForActor(db, c.mgrB, f.id), "NOT_FOUND");
  });
});

/* ------------------------------ 9. ayarlar ------------------------------ */

describe("ayarlar: uploadsEnabled", () => {
  it("varsayılan açıktır; boolean değer kaydedilir, denetim kaydı önceki ve sonraki değeri taşır", async () => {
    const c = await setupCycle();
    expect((await getSettings(db)).uploadsEnabled).toBe(true);
    await updateSettings(db, c.admin, { ...DEFAULT_SETTINGS, uploadsEnabled: false });
    expect((await getSettings(db)).uploadsEnabled).toBe(false);
    const log = await auditRows("settings.update");
    expect(log).toHaveLength(1);
    expect(log[0]!.data).toEqual({ changes: { uploadsEnabled: { from: true, to: false } } });

    await updateSettings(db, c.admin, { ...DEFAULT_SETTINGS, uploadsEnabled: true });
    const log2 = (await auditRows("settings.update")).sort((a, b) => a.id - b.id);
    expect(log2).toHaveLength(2);
    expect(log2[1]!.data).toEqual({ changes: { uploadsEnabled: { from: false, to: true } } });
  });

  it("boolean olmayan değer reddedilir; yalnız ana yönetici değiştirebilir", async () => {
    const c = await setupCycle();
    for (const bad of ["false", 0, 1, null]) {
      await expect(updateSettings(db, c.admin, { ...DEFAULT_SETTINGS, uploadsEnabled: bad })).rejects.toBeDefined();
    }
    await expectCode(updateSettings(db, c.mgrA, { ...DEFAULT_SETTINGS, uploadsEnabled: false }), "FORBIDDEN");
    expect((await getSettings(db)).uploadsEnabled).toBe(true);
  });
});
