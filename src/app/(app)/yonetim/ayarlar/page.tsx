import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { APP_TIMEZONE } from "@/lib/contracts/settings";
import { getSettingsView } from "@/server/settings-admin";
import { SettingsForm } from "./SettingsForm";

export const metadata = { title: "Ayarlar" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = await requirePageMainAdmin();
  const view = await getSettingsView(db, actor);
  const when = view.updatedAt
    ? new Date(view.updatedAt).toLocaleString("tr-TR", { timeZone: APP_TIMEZONE, dateStyle: "medium", timeStyle: "short" })
    : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Ayarlar
      </h1>
      <p className="cut-panel" style={{ margin: 0, padding: 14 }}>
        Değişiklikler bundan sonraki işlemlere uygulanır.
      </p>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {when ? `Son güncelleme: ${view.updatedBy ? view.updatedBy.name : "bilinmiyor"}, ${when}` : "Henüz değiştirilmedi; varsayılan değerler kullanılıyor."}
      </p>
      <SettingsForm values={view.values} defaults={view.defaults} />
    </div>
  );
}
