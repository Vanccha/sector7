import { db } from "@/db";
import { requirePageMainAdmin } from "@/lib/auth/session";
import { APP_TIMEZONE } from "@/lib/contracts/settings";
import { getSettings } from "@/lib/settings";
import { listSprints } from "@/server/sprints";
import { addDays } from "./dates";
import { SprintManager } from "./SprintManager";

export const metadata = { title: "Sprintler" };

export default async function SprintsPage() {
  const actor = await requirePageMainAdmin();
  const [sprints, settings] = await Promise.all([listSprints(db, actor), getSettings(db)]);

  // Yeni sprint için varsayılan başlangıç: aktif (yoksa son) sprintin bitişinden sonraki gün; hiç yoksa bugün.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(new Date());
  const ref = sprints.find((s) => s.status === "active") ?? sprints[0];
  const defaultStart = ref ? addDays(ref.startDate, ref.lengthDays) : today;

  return <SprintManager sprints={sprints} defaultStart={defaultStart} defaultLengthDays={settings.sprintLengthDays} />;
}
