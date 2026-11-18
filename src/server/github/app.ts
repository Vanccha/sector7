/**
 * GitHub App istemcisi (Aşama 7.5). Yeni bağımlılık yok: REST `fetch` ile, App JWT'si (RS256) `node:crypto` ile.
 * Env çağrı anında okunur (testler değiştirebilsin). Kişisel veri loglanmaz.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { GITHUB_APP_ENV } from "@/lib/contracts/github";

const API = "https://api.github.com";
const REFRESH_MARGIN_MS = 5 * 60_000;

export class GithubError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

function privateKey(): string | null {
  const inline = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inline && inline.trim()) return inline.replace(/\\n/g, "\n");
  const path = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (path && path.trim()) {
    try {
      return readFileSync(path.trim(), "utf8");
    } catch {
      return null;
    }
  }
  return null;
}

/** GitHub senkronu açık mı: App değişkenlerinin hepsi ve özel anahtar var. */
export function githubSyncEnabled(): boolean {
  if (!GITHUB_APP_ENV.every((k) => Boolean(process.env[k]?.trim()))) return false;
  return Boolean(process.env.GITHUB_APP_PRIVATE_KEY?.trim() || process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim());
}

export function githubOrg(): string {
  return (process.env.GITHUB_ORG ?? "").trim();
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** App JWT'si: iat 60 sn geri (saat farkı), exp 9 dk sonra. */
export function createAppJwt(now: number = Date.now()): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const key = privateKey();
  if (!appId || !key) throw new GithubError(0, "GitHub App yapılandırması eksik.");
  const iat = Math.floor(now / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 60 + 9 * 60, iss: appId }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key);
  return `${head}.${body}.${b64url(sig)}`;
}

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

/** Testler için: token önbelleğini sıfırlar. */
export function __resetGithubAppForTests(): void {
  cached = null;
  inflight = null;
  botLogin = null;
}

function baseHeaders(auth: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SECTOR7",
    Authorization: auth,
  };
}

async function errorOf(res: Response): Promise<GithubError> {
  let message = `GitHub isteği başarısız (${res.status}).`;
  try {
    const j = (await res.json()) as { message?: unknown };
    if (typeof j.message === "string" && j.message) message = j.message.slice(0, 200);
  } catch {
    /* gövde yok */
  }
  return new GithubError(res.status, message);
}

async function fetchInstallationToken(): Promise<string> {
  const id = process.env.GITHUB_APP_INSTALLATION_ID?.trim();
  if (!id) throw new GithubError(0, "GitHub App yapılandırması eksik.");
  let res: Response;
  try {
    res = await globalThis.fetch(`${API}/app/installations/${encodeURIComponent(id)}/access_tokens`, {
      method: "POST",
      headers: baseHeaders(`Bearer ${createAppJwt()}`),
    });
  } catch {
    throw new GithubError(0, "GitHub'a ulaşılamadı.");
  }
  if (!res.ok) throw await errorOf(res);
  const j = (await res.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof j.token !== "string") throw new GithubError(res.status, "GitHub token yanıtı geçersiz.");
  const exp = typeof j.expires_at === "string" ? Date.parse(j.expires_at) : NaN;
  cached = { token: j.token, expiresAt: Number.isFinite(exp) ? exp : Date.now() + 55 * 60_000 };
  return j.token;
}

async function installationToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cached.token;
  inflight ??= fetchInstallationToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

let botLogin: string | null = null;

/** App'in bot kullanıcı adı (`<slug>[bot]`): `GET /app` App JWT'si ister. Alınamazsa null. */
export async function getAppBotLogin(): Promise<string | null> {
  if (botLogin) return botLogin;
  try {
    const res = await globalThis.fetch(`${API}/app`, { headers: baseHeaders(`Bearer ${createAppJwt()}`) });
    if (!res.ok) return null;
    const j = (await res.json()) as { slug?: unknown };
    if (typeof j.slug !== "string" || !j.slug) return null;
    botLogin = `${j.slug}[bot]`;
    return botLogin;
  } catch {
    return null;
  }
}

/** GitHub REST çağrısı. `path` "/" ile başlar. 204 → undefined. 401'de token sıfırlanıp bir kez yeniden denenir. */
export async function githubRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await installationToken();
    const headers = baseHeaders(`Bearer ${token}`);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await globalThis.fetch(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new GithubError(0, "GitHub'a ulaşılamadı.");
    }
    if (res.status === 401 && attempt === 0) {
      cached = null;
      continue;
    }
    if (!res.ok) throw await errorOf(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
