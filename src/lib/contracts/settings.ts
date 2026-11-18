/** Ayar anahtarları ve varsayılanları — SÖZLEŞME. Değerler `settings` tablosunda jsonb saklanır. */
import { z } from "zod";

export const settingsSchema = z.object({
  /** Sprint süresi (gün). Tema bu sürenin üç eşit diliminden hesaplanır. */
  sprintLengthDays: z.number().int().min(3).max(90),
  /** Ticket'ı alan kişinin teslim süresi (saat). */
  ticketHours: z.number().int().min(1).max(24 * 30),
  /** Bitişten ne kadar önce uyarı gider (saat). */
  ticketWarnBeforeHours: z.number().int().min(1).max(72),
  /** Alan yöneticisinin talep cevap süresi (saat). */
  managerResponseHours: z.number().int().min(1).max(24 * 14),
  /** Sprint başına red hakkı. */
  rejectionsPerSprint: z.number().int().min(0).max(20),
  /** Tek dosya yükleme sınırı (MB). */
  uploadMaxMb: z.number().int().min(1).max(500),
  /** Aşama 7.5: teslimde sunucu diskine dosya yükleme açık mı (GitHub'a geçişte kapatılır). */
  uploadsEnabled: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  sprintLengthDays: 21,
  ticketHours: 72,
  ticketWarnBeforeHours: 12,
  managerResponseHours: 24,
  rejectionsPerSprint: 2,
  uploadMaxMb: 10,
  uploadsEnabled: true,
};

/** Uygulamanın tarih hesaplarında kullandığı saat dilimi (sprint günü vb.). */
export const APP_TIMEZONE = "Europe/Istanbul";
