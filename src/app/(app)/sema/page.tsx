import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { getLiveMap } from "@/server/live-map";
import { LiveMapView } from "./LiveMapView";

export const metadata = { title: "Şema" };

export default async function SemaPage() {
  const actor = await requirePageActor();
  const map = await getLiveMap(db, actor);
  return (
    <div className="page">
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 className="h-wide" style={{ margin: 0, fontSize: 26, lineHeight: 1.2 }}>
          Şema
        </h1>
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>
          Şu an kim hangi alanın ticket&apos;ı üzerinde çalışıyor.
        </p>
      </header>
      <LiveMapView map={map} />
    </div>
  );
}
