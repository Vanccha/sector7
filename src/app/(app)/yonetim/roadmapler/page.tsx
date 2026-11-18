import Link from "next/link";
import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { listRoadmapsForReview } from "@/server/plan";
import { RoadmapReview } from "./RoadmapReview";
import styles from "./RoadmapReview.module.css";

export const metadata = { title: "Roadmap onayı" };

export default async function RoadmapsPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string | string[] }>;
}) {
  const actor = await requirePageMainAdmin();
  const sp = await searchParams;
  const durum = Array.isArray(sp.durum) ? sp.durum[0] : sp.durum;
  const all = durum === "tumu";
  const [items, submitted] = await Promise.all([
    listRoadmapsForReview(db, actor, { status: all ? "all" : "submitted" }),
    all ? listRoadmapsForReview(db, actor, { status: "submitted" }) : Promise.resolve(null),
  ]);
  const pendingCount = (submitted ?? items).length;
  return (
    <div className={styles.page}>
      <h1 className="h-wide">Roadmap onayı</h1>
      <nav aria-label="Roadmap durumu" className={styles.tabs}>
        <Link href="/yonetim/roadmapler" className="nav-link" aria-current={!all ? "page" : undefined}>
          Bekleyen
          {pendingCount > 0 && (
            <>
              {" "}
              <span className="count">{pendingCount}</span>
            </>
          )}
        </Link>
        <Link href="/yonetim/roadmapler?durum=tumu" className="nav-link" aria-current={all ? "page" : undefined}>
          Tümü
        </Link>
      </nav>
      <RoadmapReview items={items} all={all} />
    </div>
  );
}
