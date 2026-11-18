import Link from "next/link";
import { PushToggle } from "@/components/notifications/PushToggle";
import { PrefsForm } from "@/components/notifications/PrefsForm";
import { db } from "@/db";
import { requirePageActor } from "@/lib/auth/session";
import { getNotificationSettings } from "@/server/notifications";

export const metadata = { title: "Bildirim tercihleri" };
export const dynamic = "force-dynamic";

export default async function PrefsPage() {
  const actor = await requirePageActor();
  const settings = await getNotificationSettings(db, actor);
  return (
    <div className="page page--narrow">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
          Bildirim tercihleri
        </h1>
        <Link href="/bildirimler" className="btn-line">
          Bildirimlere dön
        </Link>
      </div>
      <section aria-labelledby="push-h" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="push-h" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
          Bu cihazda push
        </h2>
        <PushToggle available={settings.push.available} publicKey={settings.push.publicKey} deviceCount={settings.push.deviceCount} />
      </section>
      <section aria-labelledby="tur-h" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="tur-h" className="h-wide" style={{ margin: 0, fontSize: 18 }}>
          Hangi bildirimleri alayım?
        </h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Uygulama içi: zilde ve Bildirimler sayfasında görünür. Push: tarayıcı kapalıyken de cihazına iletilir.
        </p>
        <PrefsForm prefs={settings.prefs} />
      </section>
    </div>
  );
}
