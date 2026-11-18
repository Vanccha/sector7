import Link from "next/link";
import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { countPendingApplications, listActiveAreas, listApplications } from "@/server/applications";
import { ApplicationReview, type ReviewItem } from "./ApplicationReview";
import styles from "./ApplicationReview.module.css";

export const metadata = { title: "Başvurular" };

const TABS = [
  { key: "bekleyen", status: "pending", label: "Bekleyen" },
  { key: "onaylanan", status: "approved", label: "Onaylanan" },
  { key: "reddedilen", status: "rejected", label: "Reddedilen" },
] as const;

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string | string[] }>;
}) {
  const actor = await requirePageMainAdmin();
  const sp = await searchParams;
  const durum = Array.isArray(sp.durum) ? sp.durum[0] : sp.durum;
  const tab = TABS.find((t) => t.key === durum) ?? TABS[0];

  const [rows, areas, pendingCount] = await Promise.all([
    listApplications(db, actor, tab.status),
    tab.status === "pending" ? listActiveAreas(db) : Promise.resolve([]),
    countPendingApplications(db, actor),
  ]);

  const items: ReviewItem[] = rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    username: r.username,
    email: r.email,
    phone: r.phone,
    intro: r.intro,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    reviewNote: r.reviewNote,
  }));

  return (
    <div className={styles.page}>
      <h1 className="h-wide">Başvurular</h1>
      <nav aria-label="Başvuru durumu" className={styles.tabs}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "bekleyen" ? "/yonetim/basvurular" : `/yonetim/basvurular?durum=${t.key}`}
            className="nav-link"
            aria-current={t.key === tab.key ? "page" : undefined}
          >
            {t.label}
            {t.key === "bekleyen" && pendingCount > 0 && (
              <>
                {" "}
                <span className="count">{pendingCount}</span>
              </>
            )}
          </Link>
        ))}
      </nav>
      <ApplicationReview status={tab.status} items={items} areas={areas} />
    </div>
  );
}
