import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { getDashboard } from "@/server/dashboard";
import { Dashboard } from "./panel/Dashboard";
import { LiveRefresh } from "./panel/LiveRefresh";

export const metadata = { title: "Yönetim paneli" };
export const dynamic = "force-dynamic";

export default async function AdminPanelPage() {
  const actor = await requirePageMainAdmin();
  const now = new Date();
  const view = await getDashboard(db, actor, now);
  return (
    <>
      <LiveRefresh />
      <Dashboard view={view} now={now.getTime()} />
    </>
  );
}
