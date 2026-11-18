import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { listAnnounceAccess } from "@/server/announce-access";
import { AnnounceAccessList } from "./AnnounceAccessList";

export const metadata = { title: "Duyuru yetkisi" };
export const dynamic = "force-dynamic";

export default async function AnnounceAccessPage() {
  const actor = await requirePageMainAdmin();
  const rows = await listAnnounceAccess(db, actor);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 800 }}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Duyuru yetkisi
      </h1>
      <p className="muted" style={{ margin: 0 }}>
        Duyuru kanalına yazabilecek kişileri seç. Ana yöneticiler her zaman yazabilir.
      </p>
      <AnnounceAccessList rows={rows} />
    </div>
  );
}
