import Link from "next/link";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { rolesOf, ROLE_LABELS } from "@/lib/contracts/actor";
import { getGithubLink, githubEnabled } from "@/server/github-link";
import { GithubCard } from "./GithubCard";
import styles from "./Profile.module.css";

export const metadata = { title: "Profil" };
export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const actor = await requirePageActor();
  const sp = await searchParams;
  const errorCode = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const enabled = githubEnabled();
  const link = enabled ? await getGithubLink(db, actor) : null;
  const roles = rolesOf(actor).map((r) => ROLE_LABELS[r]);

  return (
    <div className="page page--narrow">
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Profil
      </h1>
      <section className={`cut-panel ${styles.card}`} aria-labelledby="kimlik-h">
        <h2 id="kimlik-h" className="panel-h">
          Hesap
        </h2>
        <dl className={styles.dl}>
          <div>
            <dt className="muted">Ad</dt>
            <dd>{actor.name}</dd>
          </div>
          <div>
            <dt className="muted">Kullanıcı adı</dt>
            <dd>@{actor.username}</dd>
          </div>
          <div>
            <dt className="muted">Roller</dt>
            <dd>{roles.join(" · ")}</dd>
          </div>
        </dl>
      </section>
      <GithubCard enabled={enabled} link={link} errorCode={errorCode ?? null} />
      <p style={{ margin: 0 }}>
        <Link href="/bildirimler/tercihler" className="btn-line">
          Bildirim tercihleri
        </Link>
      </p>
    </div>
  );
}
