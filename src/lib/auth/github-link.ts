/**
 * GitHub hesap bağlama kancaları (Aşama 7.5 adım 1). Better Auth `databaseHooks.account` tarafından kullanılır.
 * - Bağlanırken access token ile GitHub kimliği (id, login) okunur ve user tablosuna yazılır.
 * - OAuth token'ları SAKLANMAZ: account satırına null yazılır.
 */
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { GITHUB_PROVIDER_ID } from "@/lib/contracts/github";

const githubProfileSchema = z.object({ id: z.number().int().positive(), login: z.string().min(1) });
export type GithubIdentity = { id: string; login: string };

/** Bağlantı anında before→after arasında kimliği taşır (anahtar: userId:accountId). */
const pending = new Map<string, GithubIdentity>();
const key = (userId: string, accountId: string) => `${userId}:${accountId}`;

/** GitHub'dan kimliği okur; başarısızsa null. User-Agent'ta kişisel veri yok. */
export async function fetchGithubIdentity(accessToken: string): Promise<GithubIdentity | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "SECTOR7",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const p = githubProfileSchema.safeParse(await res.json());
    return p.success ? { id: String(p.data.id), login: p.data.login } : null;
  } catch {
    return null;
  }
}

const NO_TOKENS = { accessToken: null, refreshToken: null, idToken: null } as const;

type AccountLike = { userId: string; providerId: string; accountId: string; accessToken?: string | null };

export function createGithubAccountHooks(db: DB) {
  return {
    create: {
      /** false dönerse bağlama reddedilir (Better Auth "unable_to_link_account" ile döner). */
      before: async (account: AccountLike) => {
        if (account.providerId !== GITHUB_PROVIDER_ID) return;
        if (!account.accessToken) return false;
        const identity = await fetchGithubIdentity(account.accessToken);
        if (!identity) return false;
        const [owner] = await db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.githubId, identity.id), ne(user.id, account.userId)))
          .limit(1);
        if (owner) return false;
        pending.set(key(account.userId, account.accountId), identity);
        return { data: { ...NO_TOKENS } };
      },
      after: async (account: AccountLike) => {
        if (account.providerId !== GITHUB_PROVIDER_ID) return;
        const k = key(account.userId, account.accountId);
        const identity = pending.get(k);
        pending.delete(k);
        if (!identity) return;
        await db.transaction(async (tx) => {
          await tx
            .update(user)
            .set({ githubId: identity.id, githubLogin: identity.login, githubLinkedAt: new Date() })
            .where(eq(user.id, account.userId));
          await audit(tx, {
            actorId: account.userId,
            action: "github.link",
            entityType: "user",
            entityId: account.userId,
            subjectUserId: account.userId,
            data: { login: identity.login },
          });
        });
      },
    },
    update: {
      /** Aynı hesap yeniden bağlanırsa gelen token'lar da saklanmaz. */
      before: async (account: Partial<AccountLike> & Record<string, unknown>) => {
        if (account.providerId !== undefined && account.providerId !== GITHUB_PROVIDER_ID) return;
        if (account.providerId === undefined && account.accessToken === undefined) return;
        return { data: { ...NO_TOKENS } };
      },
    },
  };
}
