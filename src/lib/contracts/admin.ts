/**
 * Aşama 5 (Ana yönetici paneli) sözleşmesi — SÖZLEŞME (teknik lider yazar; alt ajanlar değiştirmez).
 * Hepsi YALNIZ ana yöneticiye açıktır (servisler `requireMainAdmin` ile başlar).
 * Geliştirici kararı (2026-11-18): üye pasifleştirilebilir. Pasif kişi giriş yapamaz, açık oturumları kapanır;
 * elindeki ticket'lara otomatik bir şey olmaz — panelde "pasif kişide kalan" olarak öne çıkar ve
 * alan yöneticisi / ana yönetici `reclaimTicket` ile havuza döndürür.
 * Uygulama:
 *  - src/server/dashboard.ts   getDashboard
 *  - src/server/audit-log.ts   listAuditLog, auditLogCsv, getAuditFilterOptions
 *  - src/server/users.ts       listUsers, revealPersonalData, setHomeArea, setUserActive, reclaimTicket
 *                              (+ mevcut accounts.ts: issueResetLink, setMainAdmin)
 *  - src/server/settings-admin.ts getSettingsView, updateSettings
 */
import { z } from "zod";
import type { UserOption, SprintRow, RoadmapStatus } from "./plan";
import type { OpenRequestRow, TrackingRow, Verdict } from "./tickets";
import { settingsSchema, type Settings } from "./settings";

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export type StatusCounts = {
  draft: number;
  /** available + returned_to_pool */
  pool: number;
  offered: number;
  /** taken + extension_pending + withdrawal_pending */
  inProgress: number;
  /** inProgress içinden süresi dolmuş (duraklı değil, dueAt <= şimdi). */
  overdue: number;
  submitted: number;
  evaluated: number;
  cancelled: number;
  total: number;
};

export type DashboardAreaRow = {
  id: string;
  name: string;
  manager: UserOption | null;
  /** Yönetici atanmamış ya da pasif. */
  managerMissing: boolean;
  counts: StatusCounts;
  pendingRequests: number;
  overdueRequests: number;
  /** submitted (değerlendirme bekleyen). */
  toEvaluate: number;
  /** Aktif sprintteki roadmap durumu (yoksa null). */
  roadmapStatus: RoadmapStatus | null;
};

export type RecentEvaluation = {
  ticketId: string;
  ticketTitle: string;
  areaName: string;
  assignee: UserOption | null;
  evaluator: UserOption;
  verdict: Verdict;
  comment: string | null;
  createdAt: string;
};

export type DashboardView = {
  /** Aktif sprint ve gün bilgisi; yoksa null. */
  sprint: (SprintRow & { day: number; daysLeft: number }) | null;
  /** Aktif sprintin tüm alanlar toplamı (sprint yoksa sıfırlar). */
  totals: StatusCounts;
  /** Arşivsiz alanlar, ada göre; aktif sprint kapsamında. */
  areas: DashboardAreaRow[];
  /** Kapanış aşamasındaki sprintler ve kararsız ticket sayıları. */
  closingSprints: { sprint: SprintRow; undecided: number }[];
  /** Bekleyen talepler, cevapsızlar önce (en fazla 20) ve toplam sayılar. */
  requests: { items: OpenRequestRow[]; pending: number; overdue: number };
  /** Süresi dolmuş, sürmekte olan ticket'lar (tüm sprintler; en fazla 20, en eski dolan önce). */
  overdueTickets: TrackingRow[];
  /** Pasif kişide kalan teklif/sürmekte olan ticket'lar. */
  inactiveHeld: TrackingRow[];
  /** Aktif sprintteki değerlendirme özeti + son 10 değerlendirme. */
  evaluations: { good: number; bad: number; recent: RecentEvaluation[] };
  pendingApplications: number;
  roadmapsAwaiting: number;
  /** Son 15 denetim kaydı. */
  recentActivity: AuditRow[];
};

/* ------------------------------------------------------------------ */
/* Ayarlar                                                             */
/* ------------------------------------------------------------------ */

/** Tüm ayarlar birlikte gönderilir. Değişiklikler yalnız SONRAKİ işlemlere uygulanır (ör. ticketHours yeni alınan ticket'lara). */
export const updateSettingsSchema = settingsSchema;

export const SETTING_META: Record<keyof Settings, { label: string; unit: string; help: string }> = {
  sprintLengthDays: { label: "Sprint süresi", unit: "gün", help: "Yeni açılan sprintlerin varsayılan süresi. Tema bu sürenin üç eşit diliminden hesaplanır." },
  ticketHours: { label: "Ticket teslim süresi", unit: "saat", help: "Ticket'ı alan kişinin süresi. Yalnız bundan sonra alınan ticket'lara uygulanır." },
  ticketWarnBeforeHours: { label: "Süre uyarısı", unit: "saat önce", help: "Bitişten bu kadar önce kişiye uyarı gider." },
  managerResponseHours: { label: "Yönetici cevap süresi", unit: "saat", help: "Ek süre / geri çekme taleplerine cevap süresi. Yeni taleplere uygulanır." },
  rejectionsPerSprint: { label: "Red hakkı", unit: "sprint başına", help: "Kişinin bir sprintte reddedebileceği teklif sayısı. Hemen geçerli olur." },
  uploadMaxMb: { label: "Dosya boyutu sınırı", unit: "MB", help: "Teslimde tek dosya için üst sınır." },
  uploadsEnabled: {
    label: "Sunucuya dosya yükleme",
    unit: "",
    help: "Kapalıyken teslimde dosya yüklenmez; teslim PR ve bağlantılarla yapılır. Mevcut dosyalar korunur.",
  },
};

export type SettingsView = {
  values: Settings;
  defaults: Settings;
  updatedAt: string | null;
  updatedBy: UserOption | null;
};

/* ------------------------------------------------------------------ */
/* Denetim kaydı                                                       */
/* ------------------------------------------------------------------ */

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_CSV_MAX_ROWS = 10_000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı.");

/**
 * Filtreler. Tarihler uygulama saat diliminde (Europe/Istanbul) gün olarak; `to` dahil.
 * `action`: tam eylem adı ("ticket.submit") ya da grup öneki ("ticket." gibi noktayla biten).
 * `personId`: kişinin YAPTIĞI ya da ETKİLENDİĞİ kayıtlar (actorId ya da subjectUserId).
 */
export const auditFilterSchema = z.object({
  personId: z.uuid().nullable().default(null),
  areaId: z.uuid().nullable().default(null),
  ticketId: z.uuid().nullable().default(null),
  action: z.string().trim().max(80).nullable().default(null),
  from: isoDate.nullable().default(null),
  to: isoDate.nullable().default(null),
  /** Sonraki sayfa: önceki sayfanın son kaydının id'si (azalan sırada bundan küçükler). */
  cursor: z.number().int().positive().nullable().default(null),
});
export type AuditFilter = z.input<typeof auditFilterSchema>;

export type AuditRow = {
  id: number;
  createdAt: string;
  action: string;
  /** AUDIT_ACTION_LABELS'tan; bilinmeyen eylemde eylem adı. */
  actionLabel: string;
  /** null: sistem (zamanlayıcı, CLI). */
  actor: UserOption | null;
  entityType: string;
  entityId: string | null;
  area: { id: string; name: string } | null;
  ticket: { id: string; title: string } | null;
  subject: UserOption | null;
  data: Record<string, unknown>;
  /** Mesaj kayıtlarında (message.send, request.message ya da data.messageId) mesajın metni. */
  messageBody: string | null;
};

export type AuditPage = { rows: AuditRow[]; nextCursor: number | null };

export type AuditFilterOptions = {
  people: UserOption[];
  areas: { id: string; name: string }[];
  /** Grup önekleri ve etiketleri (ör. { value: "ticket.", label: "Ticket" }) + tek tek eylemler. */
  actionGroups: { value: string; label: string }[];
  actions: { value: string; label: string }[];
};

/* ------------------------------------------------------------------ */
/* Üyeler                                                              */
/* ------------------------------------------------------------------ */

export const listUsersSchema = z.object({
  query: z.string().trim().max(100).default(""),
  status: z.enum(["all", "active", "inactive"]).default("all"),
});

export const userRefSchema = z.object({ userId: z.uuid() });
export const setHomeAreaSchema = z.object({ userId: z.uuid(), areaId: z.uuid().nullable() });
export const setUserActiveSchema = z.object({ userId: z.uuid(), active: z.boolean() });
export const setMainAdminSchema = z.object({ userId: z.uuid(), value: z.boolean() });
export const reclaimTicketSchema = z.object({ ticketId: z.uuid() });

/** Kişisel veri İÇERMEZ (e-posta/telefon yalnız revealPersonalData ile, denetim kaydıyla). */
export type UserAdminRow = {
  id: string;
  name: string;
  username: string;
  homeArea: { id: string; name: string } | null;
  managedAreas: { id: string; name: string }[];
  isMainAdmin: boolean;
  canAnnounce: boolean;
  active: boolean;
  createdAt: string;
  /** Teklif + sürmekte olan ticket sayısı. */
  heldTickets: number;
  /** Bu sprintte teslim / değerlendirilen sayısı (bilgi amaçlı; puan değildir). */
  submittedThisSprint: number;
};

export type PersonalData = { userId: string; email: string; phone: string | null };
