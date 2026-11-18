/** YYYY-AA-GG tarihine gün ekler (saat dilimsiz, UTC üzerinden). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" });
export function formatDate(date: string): string {
  return fmt.format(new Date(`${date}T00:00:00Z`));
}

/** Bitiş tarihi = başlangıç + süre - 1. */
export function endDate(start: string, lengthDays: number): string {
  return addDays(start, lengthDays - 1);
}
