import Link from "next/link";
import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { listActiveAreas } from "@/server/applications";
import { listUsers } from "@/server/users";
import { MemberList } from "./MemberList";
import styles from "./Members.module.css";

export const metadata = { title: "Üyeler" };
export const dynamic = "force-dynamic";

const STATUS = [
  { key: "", status: "all", label: "Tümü" },
  { key: "aktif", status: "active", label: "Aktif" },
  { key: "pasif", status: "inactive", label: "Pasif" },
] as const;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; durum?: string | string[] }>;
}) {
  const actor = await requirePageMainAdmin();
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const tab = STATUS.find((s) => s.key === first(sp.durum)) ?? STATUS[0];
  const [rows, areas] = await Promise.all([
    listUsers(db, actor, { query: q, status: tab.status }),
    listActiveAreas(db),
  ]);

  const href = (key: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (key) p.set("durum", key);
    const s = p.toString();
    return s ? `/yonetim/uyeler?${s}` : "/yonetim/uyeler";
  };

  return (
    <div className={styles.page}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Üyeler
      </h1>
      <form method="get" action="/yonetim/uyeler" className={styles.search} role="search">
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label className="label" htmlFor="uye-ara">
            Kişi ara
          </label>
          <input id="uye-ara" name="q" type="search" className="input" defaultValue={q} placeholder="Ad ya da kullanıcı adı" maxLength={100} />
        </div>
        {tab.key ? <input type="hidden" name="durum" value={tab.key} /> : null}
        <button type="submit" className="btn-solid">
          Ara
        </button>
      </form>
      <nav aria-label="Durum süzmesi" className={styles.tabs}>
        {STATUS.map((s) => (
          <Link key={s.key || "tumu"} href={href(s.key)} className="nav-link" aria-current={s.key === tab.key ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>
      <p className="muted" style={{ margin: 0 }} role="status">
        {rows.length} kişi
      </p>
      <MemberList rows={rows} areas={areas} />
    </div>
  );
}
