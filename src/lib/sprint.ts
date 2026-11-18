/** Sprint günü ve tema hesapları (saf fonksiyonlar). */
import { APP_TIMEZONE } from "./contracts/settings";

export type SprintTheme = "blue" | "amber" | "red";
export type SprintLamp = "green" | "yellow" | "red";

/** Verilen andaki takvim günü (YYYY-MM-DD), uygulama saat diliminde. */
export function localDateString(at: Date = new Date(), timeZone = APP_TIMEZONE): string {
  // en-CA biçimi YYYY-MM-DD verir.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

/**
 * Sprintin kaçıncı günü (1..lengthDays). Başlangıç gününde 1.
 * Başlangıçtan önce 1'e, bitişten sonra lengthDays'e sabitlenir.
 */
export function sprintDay(startDate: string, lengthDays: number, today: string = localDateString()): number {
  const raw = dayNumber(today) - dayNumber(startDate) + 1;
  return Math.max(1, Math.min(lengthDays, raw));
}

/** Sprint üç eşit dilime bölünür: ilk dilim mavi, ikinci kehribar, üçüncü kırmızı. */
export function themePhase(day: number, lengthDays: number): 1 | 2 | 3 {
  const p = Math.ceil((day * 3) / lengthDays);
  return (Math.max(1, Math.min(3, p)) as 1 | 2 | 3);
}

const THEMES = { 1: "blue", 2: "amber", 3: "red" } as const satisfies Record<1 | 2 | 3, SprintTheme>;
const LAMPS = { 1: "green", 2: "yellow", 3: "red" } as const satisfies Record<1 | 2 | 3, SprintLamp>;

export function themeFor(day: number, lengthDays: number): SprintTheme {
  return THEMES[themePhase(day, lengthDays)];
}

export function lampFor(day: number, lengthDays: number): SprintLamp {
  return LAMPS[themePhase(day, lengthDays)];
}

export const LAMP_LABELS: Record<SprintLamp, string> = { green: "Yeşil", yellow: "Sarı", red: "Kırmızı" };

/** Başlıktaki gün çubuğu için her günün dilimi. */
export function dayPhases(lengthDays: number): Array<1 | 2 | 3> {
  return Array.from({ length: lengthDays }, (_, i) => themePhase(i + 1, lengthDays));
}
