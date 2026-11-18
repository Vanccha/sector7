import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { account, applications, tickets, user } from "../../src/db/schema";
import { createGithubAccountHooks } from "../../src/lib/auth/github-link";
import { GITHUB_REQUIRED_MESSAGE } from "../../src/lib/contracts/github";
import { getGithubLink, unlinkGithub } from "../../src/server/github-link";
import { approveApplication, submitApplication } from "../../src/server/applications";
import { acceptOffer, requestTicket } from "../../src/server/pool";
import { authRequest, db, makeActor, makeArea, makeMainAdmin, makeUser, resetDb } from "../helpers/db";
import { poolTicket, setSetting, setupCycle, ticketById, T0 } from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { AppError } from "../../src/lib/contracts/errors";
import { auditRows } from "../helpers/plan";

beforeEach(resetDb);

const savedId = process.env.GITHUB_CLIENT_ID;
const savedSecret = process.env.GITHUB_CLIENT_SECRET;
function setGithubEnv(on: boolean) {
  if (on) {
    process.env.GITHUB_CLIENT_ID = "test-id";
    process.env.GITHUB_CLIENT_SECRET = "test-secret";
  } else {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  }
}
afterEach(() => {
  if (savedId === undefined) delete process.env.GITHUB_CLIENT_ID;
  else process.env.GITHUB_CLIENT_ID = savedId;
  if (savedSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET;
  else process.env.GITHUB_CLIENT_SECRET = savedSecret;
  vi.restoreAllMocks();
});

const linked = { githubId: "1001", githubLogin: "octo-cat", githubLinkedAt: new Date("2026-11-01T10:00:00Z") };

describe("başvuruda GitHub kullanıcı adı", () => {
  const input = (over: Record<string, string> = {}) => ({
    fullName: "Ayşe Yılmaz",
    username: "ayse",
    email: "ayse@example.com",
    phone: "0532 123 45 67",
    intro: "Yazılım ve tasarım ile ilgileniyorum, topluluğa katkı vermek istiyorum.",
    ...over,
  });

  it("saklanır (@ atılır), yoksa null", async () => {
    const { id } = await submitApplication(db, input({ githubUsername: "@ad" }) as never);
    const [r] = await db.select().from(applications).where(eq(applications.id, id));
    expect(r?.githubUsername).toBe("ad");
    const { id: id2 } = await submitApplication(db, input({ username: "veli", email: "veli@example.com" }) as never);
    const [r2] = await db.select().from(applications).where(eq(applications.id, id2));
    expect(r2?.githubUsername).toBeNull();
  });

  it("onayda kullanıcının githubId/githubLogin alanı dolmaz", async () => {
    const admin = await makeMainAdmin();
    const area = await makeArea();
    const { id } = await submitApplication(db, input({ githubUsername: "ad" }) as never);
    const res = await approveApplication(db, admin, { applicationId: id, homeAreaId: area.id });
    const [u] = await db.select().from(user).where(eq(user.id, res.userId));
    expect(u?.githubId).toBeNull();
    expect(u?.githubLogin).toBeNull();
    expect(u?.githubLinkedAt).toBeNull();
  });
});

describe("ticket kabulünde GitHub zorunluluğu", () => {
  it("entegrasyon kapalıyken bağlı olmayan üye teklifi kabul eder", async () => {
    setGithubEnv(false);
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    const r = await requestTicket(db, c.member, T0);
    expect(r.kind).toBe("offered");
    await acceptOffer(db, c.member, { ticketId: t.id }, T0);
    expect((await ticketById(t.id)).status).toBe("taken");
  });

  it("açıkken bağlı olmayan üye teklif çeker ama kabul INVALID_STATE; ticket offered kalır", async () => {
    setGithubEnv(true);
    const c = await setupCycle();
    const t = await poolTicket(c, c.areaA.id);
    const r = await requestTicket(db, c.member, T0);
    expect(r.kind).toBe("offered");
    let err: unknown;
    try {
      await acceptOffer(db, c.member, { ticketId: t.id }, T0);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("INVALID_STATE");
    expect((err as AppError).message).toBe(GITHUB_REQUIRED_MESSAGE);
    const after = await ticketById(t.id);
    expect(after.status).toBe("offered");
    expect(after.assigneeId).toBe(c.member.id);
  });

  it("açıkken bağlı üye kabul eder", async () => {
    setGithubEnv(true);
    const c = await setupCycle();
    await db.update(user).set(linked).where(eq(user.id, c.member.id));
    const t = await poolTicket(c, c.areaA.id);
    await requestTicket(db, c.member, T0);
    await acceptOffer(db, c.member, { ticketId: t.id }, T0);
    expect((await ticketById(t.id)).status).toBe("taken");
  });

  it("açıkken red hakkı bitmiş bağlı olmayan üye ticket çekemez; havuz değişmez", async () => {
    setGithubEnv(true);
    const c = await setupCycle();
    await setSetting("rejectionsPerSprint", 0);
    const t = await poolTicket(c, c.areaA.id);
    await expectCode(requestTicket(db, c.member, T0), "INVALID_STATE");
    const after = await ticketById(t.id);
    expect(after.status).toBe("available");
    expect(after.assigneeId).toBeNull();
    expect(await auditRows("ticket.request_draw")).toHaveLength(0);
  });

  it("açıkken red hakkı bitmiş bağlı üye doğrudan atanır", async () => {
    setGithubEnv(true);
    const c = await setupCycle();
    await setSetting("rejectionsPerSprint", 0);
    await db.update(user).set(linked).where(eq(user.id, c.member.id));
    const t = await poolTicket(c, c.areaA.id);
    const r = await requestTicket(db, c.member, T0);
    expect(r.kind).toBe("taken");
    expect((await ticketById(t.id)).assigneeId).toBe(c.member.id);
  });

  it("kapalıyken red hakkı bitmiş bağlı olmayan üye doğrudan atanır", async () => {
    setGithubEnv(false);
    const c = await setupCycle();
    await setSetting("rejectionsPerSprint", 0);
    await poolTicket(c, c.areaA.id);
    expect((await requestTicket(db, c.member, T0)).kind).toBe("taken");
    expect(await db.select().from(tickets).where(eq(tickets.assigneeId, c.member.id))).toHaveLength(1);
  });
});

describe("getGithubLink / unlinkGithub", () => {
  it("bağlıyken login ve linkedAt döner", async () => {
    const me = await makeActor(linked);
    expect(await getGithubLink(db, me)).toEqual({ login: "octo-cat", linkedAt: linked.githubLinkedAt.toISOString() });
  });

  it("bağlı değilken null", async () => {
    const me = await makeActor();
    expect(await getGithubLink(db, me)).toBeNull();
  });

  it("oturumsuz UNAUTHENTICATED", async () => {
    await expectCode(getGithubLink(db, null), "UNAUTHENTICATED");
    await expectCode(unlinkGithub(db, null), "UNAUTHENTICATED");
  });

  it("unlink account satırını siler, alanları temizler, denetim yazar", async () => {
    const me = await makeActor(linked);
    await db.insert(account).values({ accountId: "1001", providerId: "github", userId: me.id });
    await db.insert(account).values({ accountId: me.id, providerId: "credential", userId: me.id, password: "x" });
    await unlinkGithub(db, me);
    const accs = await db.select().from(account).where(eq(account.userId, me.id));
    expect(accs.map((a) => a.providerId)).toEqual(["credential"]);
    const [u] = await db.select().from(user).where(eq(user.id, me.id));
    expect(u?.githubId).toBeNull();
    expect(u?.githubLogin).toBeNull();
    expect(u?.githubLinkedAt).toBeNull();
    expect(await getGithubLink(db, me)).toBeNull();
    const logs = await auditRows("github.unlink", me.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorId).toBe(me.id);
  });

  it("bağlı değilken no-op, denetim kaydı yok", async () => {
    const me = await makeActor();
    await unlinkGithub(db, me);
    expect(await auditRows("github.unlink")).toHaveLength(0);
  });

  it("başkasının bağlantısına dokunmaz", async () => {
    const me = await makeActor(linked);
    const other = await makeActor({ githubId: "2002", githubLogin: "other", githubLinkedAt: new Date() });
    await unlinkGithub(db, me);
    expect(await getGithubLink(db, other)).not.toBeNull();
  });
});

describe("hesap kancaları", () => {
  const hooks = () => createGithubAccountHooks(db);
  const mockFetch = (res: Response | Error) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (res instanceof Error) throw res;
      return res;
    });
  const ok = (id: number, login: string) =>
    new Response(JSON.stringify({ id, login }), { status: 200, headers: { "content-type": "application/json" } });
  let n = 0;
  const acc = (userId: string, over: Record<string, unknown> = {}) => ({
    userId,
    providerId: "github",
    accountId: `acc-${++n}`,
    accessToken: "gho_token",
    ...over,
  });

  it("create.before: github değilse undefined, fetch çağrılmaz", async () => {
    const f = mockFetch(ok(1, "x"));
    const u = await makeUser();
    expect(await hooks().create.before(acc(u.id, { providerId: "credential" }))).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("create.before: token yoksa false", async () => {
    const f = mockFetch(ok(1, "x"));
    const u = await makeUser();
    expect(await hooks().create.before(acc(u.id, { accessToken: null }))).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("create.before: GitHub 401 -> false; ağ hatası -> false", async () => {
    const u = await makeUser();
    mockFetch(new Response("{}", { status: 401 }));
    expect(await hooks().create.before(acc(u.id))).toBe(false);
    vi.restoreAllMocks();
    mockFetch(new Error("ağ yok"));
    expect(await hooks().create.before(acc(u.id))).toBe(false);
  });

  it("create.before: aynı GitHub id başka kullanıcıdaysa false", async () => {
    await makeUser({ githubId: "1001", githubLogin: "octo-cat", githubLinkedAt: new Date() });
    const u = await makeUser();
    mockFetch(ok(1001, "octo-cat"));
    expect(await hooks().create.before(acc(u.id))).toBe(false);
  });

  it("create.before: başarıda token'lar null; User-Agent SECTOR7 ve Bearer", async () => {
    const u = await makeUser();
    const f = mockFetch(ok(1001, "octo-cat"));
    const res = await hooks().create.before(acc(u.id, { accessToken: "gho_abc" }));
    expect(res).toEqual({ data: { accessToken: null, refreshToken: null, idToken: null } });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://api.github.com/user");
    const h = new Headers((init as RequestInit).headers);
    expect(h.get("user-agent")).toBe("SECTOR7");
    expect(h.get("authorization")).toBe("Bearer gho_abc");
  });

  it("create.before: aynı kullanıcı kendi id'sini yeniden bağlayabilir", async () => {
    const u = await makeUser({ githubId: "1001", githubLogin: "octo-cat", githubLinkedAt: new Date() });
    mockFetch(ok(1001, "octo-cat"));
    expect(await hooks().create.before(acc(u.id))).toEqual({
      data: { accessToken: null, refreshToken: null, idToken: null },
    });
  });

  it("create.after: user alanları yazılır, github.link denetimi düşer", async () => {
    const u = await makeUser();
    mockFetch(ok(1001, "octo-cat"));
    const h = hooks();
    const a = acc(u.id);
    await h.create.before(a);
    await h.create.after(a);
    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row?.githubId).toBe("1001");
    expect(row?.githubLogin).toBe("octo-cat");
    expect(row?.githubLinkedAt).toBeInstanceOf(Date);
    const logs = await auditRows("github.link", u.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorId).toBe(u.id);
  });

  it("create.after: before çalışmadıysa (bekleyen kimlik yok) hiçbir şey yazmaz", async () => {
    const u = await makeUser();
    await hooks().create.after(acc(u.id));
    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row?.githubId).toBeNull();
    expect(await auditRows("github.link")).toHaveLength(0);
  });

  it("create.after: github olmayan sağlayıcıda dokunmaz", async () => {
    const u = await makeUser();
    await hooks().create.after(acc(u.id, { providerId: "credential" }));
    expect(await auditRows("github.link")).toHaveLength(0);
  });

  it("update.before: github için token'ları null'lar; credential şifre güncellemesine dokunmaz", async () => {
    const h = hooks();
    expect(await h.update.before({ providerId: "github", accessToken: "t" })).toEqual({
      data: { accessToken: null, refreshToken: null, idToken: null },
    });
    expect(await h.update.before({ providerId: "credential", password: "hash" })).toBeUndefined();
    expect(await h.update.before({ password: "hash" })).toBeUndefined();
  });
});

describe("GitHub ile giriş / token uçları kapalı", () => {
  it.each(["/sign-in/social", "/unlink-account", "/get-access-token", "/refresh-token", "/account-info"])(
    "%s 404 döner (entegrasyon kapalı)",
    async (path) => {
      setGithubEnv(false);
      const res = await authRequest(path, { provider: "github", callbackURL: "/" });
      expect(res.status).toBe(404);
    },
  );

  it("sign-in/social GitHub yapılandırılmış olsa da 404 (disabledPaths)", async () => {
    // auth modülü yüklendiğinde env'e göre kurulur; yol yine de kapalıdır.
    setGithubEnv(true);
    const res = await authRequest("/sign-in/social", { provider: "github", callbackURL: "/" });
    expect(res.status).toBe(404);
  });
});
