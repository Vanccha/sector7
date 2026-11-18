/**
 * Aşama 2 (Plan) sözleşmesi: alanlar, sprintler, hedefler, roadmap, ticket'lar, bağımlılıklar.
 * Kurallar ve tipler burada; uygulama src/server/{areas,sprints,plan,tickets,dependencies}.ts.
 * Geliştirici kararları (2026-11-18):
 *  - Ön koşul "bitti" = teslim edildi (submitted) ya da sonrası (evaluated). İptal edilen ön koşul engel olmaz.
 *  - Onaylı roadmap'in basamakları değişirse roadmap yeniden onaya düşer (status → submitted).
 *  - Bağımlılık alanlar arası kurulabilir. Bağımlılığı, BEKLEYEN (bağımlı) ticket'ın alanını yöneten kişi kurar/kaldırır.
 *  - Sprintleri ana yönetici elle açar ve başlatır.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Ticket durum grupları                                               */
/* ------------------------------------------------------------------ */

export type TicketStatus =
  | "draft"
  | "available"
  | "offered"
  | "taken"
  | "submitted"
  | "evaluated"
  | "extension_pending"
  | "withdrawal_pending"
  | "returned_to_pool"
  | "cancelled";

/** Bu durumdaki ön koşul, bağımlı ticket'ı engellemez. */
export const PREREQ_DONE_STATUSES = ["submitted", "evaluated", "cancelled"] as const satisfies readonly TicketStatus[];

/** Havuzda (yayınlanmış, kimsede değil). Ön koşulları bittiyse "alınabilir". */
export const POOL_STATUSES = ["available", "returned_to_pool"] as const satisfies readonly TicketStatus[];

/** Alan arşivlenirken uyarı gerektiren "aktif" ticket durumları. */
export const ACTIVE_TICKET_STATUSES = [
  "available",
  "returned_to_pool",
  "offered",
  "taken",
  "extension_pending",
  "withdrawal_pending",
  "submitted",
] as const satisfies readonly TicketStatus[];

/** Başlığı/açıklaması ve ön koşulları düzenlenebilen durumlar (kimse almamışken). */
export const TICKET_EDITABLE_STATUSES = ["draft", "available", "returned_to_pool"] as const satisfies readonly TicketStatus[];

export const isPrereqDone = (s: TicketStatus) => (PREREQ_DONE_STATUSES as readonly string[]).includes(s);
export const isInPool = (s: TicketStatus) => (POOL_STATUSES as readonly string[]).includes(s);
export const isTicketEditable = (s: TicketStatus) => (TICKET_EDITABLE_STATUSES as readonly string[]).includes(s);

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  draft: "Taslak",
  available: "Havuzda",
  offered: "Teklif edildi",
  taken: "Alındı",
  submitted: "Teslim edildi",
  evaluated: "Değerlendirildi",
  extension_pending: "Ek süre bekliyor",
  withdrawal_pending: "Geri çekme bekliyor",
  returned_to_pool: "Havuza döndü",
  cancelled: "İptal",
};

export type RoadmapStatus = "draft" | "submitted" | "approved" | "returned";
export const ROADMAP_STATUS_LABELS: Record<RoadmapStatus, string> = {
  draft: "Taslak",
  submitted: "Onay bekliyor",
  approved: "Onaylandı",
  returned: "Geri gönderildi",
};

export type SprintStatus = "planned" | "active" | "closing" | "closed";
export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  planned: "Planlandı",
  active: "Aktif",
  closing: "Kapanıyor",
  closed: "Kapandı",
};

/* ------------------------------------------------------------------ */
/* Girdi şemaları                                                      */
/* ------------------------------------------------------------------ */

const id = z.uuid();
const title = z.string().trim().min(2, "En az 2 karakter.").max(200, "En fazla 200 karakter.");
const longText = z.string().trim().max(5000, "En fazla 5000 karakter.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı.");

// Alanlar (yalnız ana yönetici)
export const createAreaSchema = z.object({ name: title, description: longText.default("") });
export const updateAreaSchema = z.object({ areaId: id, name: title, description: longText.default("") });
export const setAreaManagerSchema = z.object({ areaId: id, managerId: id.nullable() });
/** confirm=false iken aktif ticket varsa arşivlemez, uyarı döner. */
export const archiveAreaSchema = z.object({ areaId: id, confirm: z.boolean().default(false) });
export const areaIdSchema = z.object({ areaId: id });

// Sprintler (yalnız ana yönetici)
export const createSprintSchema = z.object({
  startDate: isoDate,
  /** Boşsa ayarlardaki sprintLengthDays. */
  lengthDays: z.number().int().min(3).max(90).optional(),
  /** Boşsa "Sprint {numara}". */
  name: z.string().trim().min(1).max(60).optional(),
});
export const updateSprintSchema = z.object({
  sprintId: id,
  startDate: isoDate,
  lengthDays: z.number().int().min(3).max(90),
  name: z.string().trim().min(1).max(60),
});
export const sprintIdSchema = z.object({ sprintId: id });

// Hedefler (alan yöneticisi ya da ana yönetici)
export const createGoalSchema = z.object({
  areaId: id,
  sprintId: id,
  title,
  requirements: longText.default(""),
});
export const updateGoalSchema = z.object({ goalId: id, title, requirements: longText.default("") });
export const goalIdSchema = z.object({ goalId: id });

// Roadmap basamakları
export const addStepSchema = z.object({
  areaId: id,
  sprintId: id,
  title,
  description: longText.default(""),
  goalId: id.nullable().default(null),
});
export const updateStepSchema = z.object({
  stepId: id,
  title,
  description: longText.default(""),
  goalId: id.nullable().default(null),
});
export const stepIdSchema = z.object({ stepId: id });
/** Roadmap'in tüm basamak kimlikleri, yeni sırayla. */
export const reorderStepsSchema = z.object({ roadmapId: id, stepIds: z.array(id).min(1) });
export const roadmapRefSchema = z.object({ areaId: id, sprintId: id });
export const roadmapIdSchema = z.object({ roadmapId: id });
export const returnRoadmapSchema = z.object({
  roadmapId: id,
  note: z.string().trim().min(3, "Geri gönderme nedeni yaz.").max(2000),
});

// Ticket'lar
export const createTicketSchema = z.object({
  roadmapStepId: id,
  /** Boşsa basamağın başlığı/açıklaması kullanılır. */
  title: title.optional(),
  description: longText.optional(),
});
export const updateTicketSchema = z.object({ ticketId: id, title, description: longText.default("") });
export const ticketIdSchema = z.object({ ticketId: id });
export const publishTicketsSchema = z.object({ ticketIds: z.array(id).min(1).max(500) });
export const ticketPositionSchema = z.object({
  ticketId: id,
  x: z.number().finite(),
  y: z.number().finite(),
});
export const dependencySchema = z
  .object({ ticketId: id, dependsOnId: id })
  .refine((v) => v.ticketId !== v.dependsOnId, { message: "Ticket kendine bağlanamaz.", path: ["dependsOnId"] });
export const searchPrereqSchema = z.object({
  ticketId: id,
  query: z.string().trim().max(100).default(""),
});

/* ------------------------------------------------------------------ */
/* Çıktı tipleri                                                       */
/* ------------------------------------------------------------------ */

export type UserOption = { id: string; name: string; username: string };

export type AreaRow = {
  id: string;
  name: string;
  description: string;
  managerId: string | null;
  managerName: string | null;
  archivedAt: string | null; // ISO
  activeTicketCount: number;
};

/** archiveArea sonucu: aktif ticket varsa ve onay yoksa arşivlemez. */
export type ArchiveResult = { archived: true } | { archived: false; activeTicketCount: number };

export type SprintRow = {
  id: string;
  number: number;
  name: string;
  startDate: string; // YYYY-MM-DD
  lengthDays: number;
  status: SprintStatus;
};

export type GoalRow = { id: string; sprintId: string; areaId: string; title: string; requirements: string };

export type StepRow = {
  id: string;
  position: number;
  title: string;
  description: string;
  goalId: string | null;
  ticketCount: number;
};

export type RoadmapView = {
  /** Henüz basamak eklenmediyse null (roadmap ilk basamakla oluşur). */
  id: string | null;
  sprintId: string;
  areaId: string;
  status: RoadmapStatus;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  steps: StepRow[];
};

export type AreaPlan = {
  area: { id: string; name: string; archived: boolean };
  sprint: SprintRow;
  goals: GoalRow[];
  roadmap: RoadmapView;
  /** Aktör bu alanı düzenleyebilir mi (alan yöneticisi ya da ana yönetici, sprint kapanmamış, alan arşivli değil). */
  canEdit: boolean;
};

export type RoadmapReviewItem = {
  roadmapId: string;
  area: { id: string; name: string };
  sprint: { id: string; name: string };
  status: RoadmapStatus;
  submittedAt: string | null;
  reviewNote: string | null;
  goals: GoalRow[];
  steps: StepRow[];
};

export type TicketRef = { id: string; title: string; areaId: string; areaName: string; status: TicketStatus };

export type TicketRow = {
  id: string;
  areaId: string;
  sprintId: string;
  roadmapStepId: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  posX: number | null;
  posY: number | null;
  /** Ön koşullar (başka alanlardan da olabilir). */
  prerequisites: TicketRef[];
  /** Henüz bitmemiş ön koşullar. */
  blockedBy: TicketRef[];
  /** Havuzda ve tüm ön koşulları bitmiş. */
  takeable: boolean;
};

/** Bağımlılık düzenleyicisinde gösterilen, alan dışından gelen ön koşul düğümleri. */
export type AreaTicketsView = {
  tickets: TicketRow[];
  /** Bu alandaki ticket'ların başka alanlardaki ön koşulları (salt okunur düğümler). */
  externalPrerequisites: TicketRef[];
  /** Ticket'lara bölmeye hazır basamaklar (roadmap onaylıysa). */
  steps: StepRow[];
  roadmapStatus: RoadmapStatus | null;
  canEdit: boolean;
};
