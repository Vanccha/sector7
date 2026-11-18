/** GitHub hesap bağlantısı (Aşama 7.5 adım 1). Bağlama Better Auth akışıyla (src/lib/auth/github-link.ts) olur; burada okuma/koparma/zorunluluk var. */
import { and, eq } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { account, user } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { invalidState } from "@/lib/contracts/errors";
import { GITHUB_PROVIDER_ID, GITHUB_REQUIRED_MESSAGE, type GithubLink } from "@/lib/contracts/github";

/** Entegrasyon açık mı? Env çağrı anında okunur. */
export function githubEnabled(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

async function readLink(db: DbOrTx, userId: string): Promise<GithubLink> {
  const [row] = await db
    .select({ login: user.githubLogin, linkedAt: user.githubLinkedAt, id: user.githubId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row?.id || !row.login || !row.linkedAt) return null;
  return { login: row.login, linkedAt: row.linkedAt.toISOString() };
}

/** Oturumdaki kullanıcının bağlı GitHub hesabı (yoksa null). */
export async function getGithubLink(db: DB, actor: Actor | null): Promise<GithubLink> {
  const a = requireActor(actor);
  return readLink(db, a.id);
}

/** Bağlantıyı koparır: account satırı ve user github alanları temizlenir. */
export async function unlinkGithub(db: DB, actor: Actor | null): Promise<void> {
  const a = requireActor(actor);
  await db.transaction(async (tx) => {
    const link = await readLink(tx, a.id);
    await tx.delete(account).where(and(eq(account.userId, a.id), eq(account.providerId, GITHUB_PROVIDER_ID)));
    await tx.update(user).set({ githubId: null, githubLogin: null, githubLinkedAt: null }).where(eq(user.id, a.id));
    if (link) {
      await audit(tx, {
        actorId: a.id,
        action: "github.unlink",
        entityType: "user",
        entityId: a.id,
        subjectUserId: a.id,
        data: { login: link.login },
      });
    }
  });
}

/** Ticket'ı kişiye bağlayan anlarda: entegrasyon açıksa ve hesap bağlı değilse reddeder; kapalıysa no-op. */
export async function assertGithubLinkedForTickets(tx: DbOrTx, userId: string): Promise<void> {
  if (!githubEnabled()) return;
  if (!(await readLink(tx, userId))) throw invalidState(GITHUB_REQUIRED_MESSAGE);
}
