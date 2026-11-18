import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { getAuditFilterOptions, listAuditLog } from "@/server/audit-log";
import { AuditFilters } from "./AuditFilters";
import { AuditTable } from "./AuditTable";
import { auditFilterToQuery, parseAuditSearchParams } from "./search";
import styles from "./Audit.module.css";

export const metadata = { title: "Denetim kaydı" };
export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageMainAdmin();
  const filter = parseAuditSearchParams(await searchParams);
  const query = auditFilterToQuery(filter);
  const [options, page] = await Promise.all([getAuditFilterOptions(db, actor), listAuditLog(db, actor, filter)]);

  return (
    <div className={styles.page}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Denetim kaydı
      </h1>
      <AuditFilters options={options} filter={filter} csvHref={`/api/denetim${query ? `?${query}` : ""}`} />
      <AuditTable key={query} initial={page} query={query} />
    </div>
  );
}
