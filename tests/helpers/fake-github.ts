/**
 * Sahte GitHub API'si (Aşama 7.5 testleri). `globalThis.fetch`'i taklit eder; gerçek ağ çağrısı yapılmaz.
 * Depo, issue, etiket, milestone ve ref durumu bellekte tutulur.
 */
import { createHmac, generateKeyPairSync } from "node:crypto";
import { vi } from "vitest";

export const GH_ORG = "acme";
export const GH_APP_ID = "12345";
export const GH_INSTALLATION_ID = "777";
export const GH_WEBHOOK_SECRET = "whsec_test_secret";
export const GH_BOT_SLUG = "sector7-test";
export const GH_BOT_LOGIN = `${GH_BOT_SLUG}[bot]`;

const KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_PRIVATE_KEY_PATH",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_ORG",
  "GITHUB_WEBHOOK_SECRET",
] as const;

let pem: string | null = null;
function privateKeyPem(): string {
  pem ??= generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
  return pem;
}

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
let saveTaken = false;

/** GitHub App ortam değişkenlerini açar (senkron açık). Üzerine yazılacak değerler `over` ile. */
export function enableGithubEnv(over: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}) {
  if (!saveTaken) {
    for (const k of KEYS) saved[k] = process.env[k];
    saveTaken = true;
  }
  const values: Record<(typeof KEYS)[number], string | undefined> = {
    GITHUB_APP_ID: GH_APP_ID,
    GITHUB_APP_PRIVATE_KEY: privateKeyPem(),
    GITHUB_APP_PRIVATE_KEY_PATH: undefined,
    GITHUB_APP_INSTALLATION_ID: GH_INSTALLATION_ID,
    GITHUB_ORG: GH_ORG,
    GITHUB_WEBHOOK_SECRET: GH_WEBHOOK_SECRET,
    ...over,
  };
  for (const k of KEYS) {
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
}

/** Ortamı eski hâline getirir (testten önceki değerler). */
export function restoreGithubEnv() {
  if (!saveTaken) return;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  saveTaken = false;
}

/** Tüm GitHub değişkenlerini siler (senkron kapalı). */
export function disableGithubEnv() {
  if (!saveTaken) {
    for (const k of KEYS) saved[k] = process.env[k];
    saveTaken = true;
  }
  for (const k of KEYS) delete process.env[k];
}

/** `X-Hub-Signature-256` değeri. */
export const signBody = (body: string | Buffer, secret = GH_WEBHOOK_SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

export type FakeIssue = {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason: string | null;
  labels: { name: string }[];
  milestone: number | null;
  assignees: string[];
  creator: string;
};

type FakeRepo = {
  defaultBranch: string;
  sha: string;
  issues: FakeIssue[];
  labels: Set<string>;
  milestones: { number: number; title: string }[];
  refs: Map<string, string>;
  nextIssue: number;
  nextMilestone: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeCall = { method: string; path: string; query: URLSearchParams; body: any };

export function createFakeGithub() {
  const repos = new Map<string, FakeRepo>();
  const calls: FakeCall[] = [];
  const failures: { match: (c: FakeCall) => boolean; status: number; message: string; times: number }[] = [];
  const state = {
    /** İstek işlenmeden önce çağrılır (yarış testleri için). */
    beforeRequest: undefined as undefined | ((c: FakeCall) => Promise<void> | void),
    /** İstek işlendikten sonra çağrılır. */
    afterRequest: undefined as undefined | ((c: FakeCall) => Promise<void> | void),
    networkError: null as string | null,
    latencyMs: 0,
  };

  function addRepo(name: string, o: { defaultBranch?: string; sha?: string } = {}) {
    const r: FakeRepo = {
      defaultBranch: o.defaultBranch ?? "main",
      sha: o.sha ?? "a".repeat(40),
      issues: [],
      labels: new Set(),
      milestones: [],
      refs: new Map(),
      nextIssue: 1,
      nextMilestone: 1,
    };
    r.refs.set(`refs/heads/${r.defaultBranch}`, r.sha);
    repos.set(name, r);
    return r;
  }

  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const issueOut = (repo: string, i: FakeIssue) => ({
    number: i.number,
    html_url: i.html_url,
    title: i.title,
    body: i.body,
    state: i.state,
    state_reason: i.state_reason,
    labels: i.labels,
    milestone: i.milestone === null ? null : { number: i.milestone },
    assignees: i.assignees.map((login) => ({ login })),
    user: { login: i.creator },
    repo,
  });

  function route(c: FakeCall): Response {
    const { method, path, query, body } = c;
    if (method === "POST" && path === `/app/installations/${GH_INSTALLATION_ID}/access_tokens`) {
      return json(201, { token: "ghs_fake", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (method === "GET" && path === "/app") return json(200, { slug: GH_BOT_SLUG });

    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
    if (!m) return json(404, { message: "Not Found" });
    const [, org, repoName, rest = ""] = m as unknown as [string, string, string, string?];
    const repo = repos.get(decodeURIComponent(repoName));
    if (decodeURIComponent(org) !== GH_ORG || !repo) return json(404, { message: "Not Found" });
    const repoKey = decodeURIComponent(repoName);

    if (method === "GET" && rest === "") return json(200, { default_branch: repo.defaultBranch });

    const ref = /^\/git\/ref\/(.+)$/.exec(rest);
    if (method === "GET" && ref) {
      const name = `refs/${decodeURIComponent(ref[1]!)}`;
      const sha = repo.refs.get(name);
      return sha ? json(200, { ref: name, object: { sha } }) : json(404, { message: "Not Found" });
    }
    if (method === "POST" && rest === "/git/refs") {
      if (repo.refs.has(body.ref)) return json(422, { message: "Reference already exists" });
      repo.refs.set(body.ref, body.sha);
      return json(201, { ref: body.ref, object: { sha: body.sha } });
    }

    const lab = /^\/labels\/(.+)$/.exec(rest);
    if (method === "GET" && lab) {
      const name = decodeURIComponent(lab[1]!);
      return repo.labels.has(name) ? json(200, { name }) : json(404, { message: "Not Found" });
    }
    if (method === "POST" && rest === "/labels") {
      if (repo.labels.has(body.name)) return json(422, { message: "already_exists" });
      repo.labels.add(body.name);
      return json(201, { name: body.name });
    }

    if (method === "GET" && rest === "/milestones") {
      const page = Number(query.get("page") ?? "1");
      const per = Number(query.get("per_page") ?? "30");
      return json(200, repo.milestones.slice((page - 1) * per, page * per));
    }
    if (method === "POST" && rest === "/milestones") {
      const ms = { number: repo.nextMilestone++, title: body.title as string };
      repo.milestones.push(ms);
      return json(201, ms);
    }

    if (method === "GET" && rest === "/issues") {
      const label = query.get("labels");
      const creator = query.get("creator");
      const page = Number(query.get("page") ?? "1");
      const per = Number(query.get("per_page") ?? "30");
      const list = repo.issues
        .filter((i) => !label || i.labels.some((l) => l.name === label))
        .filter((i) => !creator || i.creator === creator)
        .slice((page - 1) * per, page * per)
        .map((i) => issueOut(repoKey, i));
      return json(200, list);
    }
    if (method === "POST" && rest === "/issues") {
      const num = repo.nextIssue++;
      const i: FakeIssue = {
        number: num,
        html_url: `https://github.com/${GH_ORG}/${repoKey}/issues/${num}`,
        title: body.title,
        body: body.body ?? null,
        state: "open",
        state_reason: null,
        labels: (body.labels ?? []).map((name: string) => ({ name })),
        milestone: typeof body.milestone === "number" ? body.milestone : null,
        assignees: body.assignees ?? [],
        creator: GH_BOT_LOGIN,
      };
      if (i.milestone !== null && !repo.milestones.some((x) => x.number === i.milestone)) {
        return json(422, { message: "Validation Failed" });
      }
      repo.issues.push(i);
      return json(201, issueOut(repoKey, i));
    }
    const one = /^\/issues\/(\d+)$/.exec(rest);
    if (one) {
      const i = repo.issues.find((x) => x.number === Number(one[1]));
      if (!i) return json(404, { message: "Not Found" });
      if (method === "GET") return json(200, issueOut(repoKey, i));
      if (method === "PATCH") {
        if (typeof body.milestone === "number" && !repo.milestones.some((x) => x.number === body.milestone)) {
          return json(422, { message: "Validation Failed" });
        }
        if ("title" in body) i.title = body.title;
        if ("body" in body) i.body = body.body;
        if ("labels" in body) i.labels = (body.labels as string[]).map((name) => ({ name }));
        if ("milestone" in body) i.milestone = body.milestone;
        if ("assignees" in body) i.assignees = body.assignees;
        if ("state" in body) {
          i.state = body.state;
          i.state_reason = body.state === "open" ? null : (body.state_reason ?? "completed");
        }
        return json(200, issueOut(repoKey, i));
      }
    }
    return json(404, { message: "Not Found" });
  }

  async function handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== "https://api.github.com") throw new Error(`Beklenmeyen ağ çağrısı: ${url.href}`);
    const method = (init?.method ?? "GET").toUpperCase();
    const c: FakeCall = {
      method,
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(c);
    if (state.latencyMs) await new Promise((r) => setTimeout(r, state.latencyMs));
    if (state.networkError) throw new TypeError(state.networkError);
    await state.beforeRequest?.(c);
    const f = failures.find((x) => x.times > 0 && x.match(c));
    let res: Response;
    if (f) {
      f.times--;
      res = json(f.status, { message: f.message });
    } else {
      res = route(c);
    }
    await state.afterRequest?.(c);
    return res;
  }

  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(handle as typeof fetch);

  return {
    calls,
    state,
    repos,
    addRepo,
    repo: (name: string) => repos.get(name)!,
    /** Depoda issue'yu doğrudan oluşturur (elle açılmış/önceki koşudan kalma). */
    seedIssue(repoName: string, o: Partial<FakeIssue> & { title: string }): FakeIssue {
      const r = repos.get(repoName)!;
      const num = r.nextIssue++;
      const i: FakeIssue = {
        number: num,
        html_url: `https://github.com/${GH_ORG}/${repoName}/issues/${num}`,
        body: null,
        state: "open",
        state_reason: null,
        labels: [],
        milestone: null,
        assignees: [],
        creator: GH_BOT_LOGIN,
        ...o,
      };
      r.issues.push(i);
      return i;
    },
    /** Sonraki `times` eşleşen isteğe verilen durumla yanıt ver. */
    failWith(match: (c: FakeCall) => boolean, status: number, message: string, times = Infinity) {
      failures.push({ match, status, message, times });
    },
    clearFailures() {
      failures.length = 0;
    },
    callsTo(method: string, re: RegExp) {
      return calls.filter((c) => c.method === method && re.test(c.path));
    },
    resetCalls() {
      calls.length = 0;
    },
    restore() {
      spy.mockRestore();
    },
  };
}

export type FakeGithub = ReturnType<typeof createFakeGithub>;
