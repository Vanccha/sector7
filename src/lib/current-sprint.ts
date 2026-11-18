import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { sprints } from "@/db/schema";
import { lampFor, sprintDay, themeFor, type SprintLamp, type SprintTheme } from "./sprint";

export type SprintView = {
  id: string;
  name: string;
  startDate: string;
  lengthDays: number;
  day: number;
  daysLeft: number;
  theme: SprintTheme;
  lamp: SprintLamp;
};

/** Aktif sprint ve bugünkü günü/teması. Aktif sprint yoksa null (tema mavi kalır). */
export async function getActiveSprintView(db: DbOrTx, today?: string): Promise<SprintView | null> {
  const [s] = await db.select().from(sprints).where(eq(sprints.status, "active")).limit(1);
  if (!s) return null;
  const day = sprintDay(s.startDate, s.lengthDays, today);
  return {
    id: s.id,
    name: s.name,
    startDate: s.startDate,
    lengthDays: s.lengthDays,
    day,
    daysLeft: s.lengthDays - day,
    theme: themeFor(day, s.lengthDays),
    lamp: lampFor(day, s.lengthDays),
  };
}
