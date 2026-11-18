/**
 * Aşama 3 (Ticket döngüsü) sözleşmesi — SÖZLEŞME (teknik lider yazar; alt ajanlar kullanır, değiştirmez).
 * Kurallar: docs/KARARLAR.md "Aşama 3". Uygulama:
 *  - src/server/pool.ts            requestTicket, acceptOffer, rejectOffer, getMyTickets
 *  - src/server/ticket-requests.ts createRequest, postRequestMessage, approveRequest, rejectRequest, cancelRequest
 *  - src/server/ticket-view.ts     getTicketDetail, getAreaTracking, listOpenRequests
 *  - src/server/delivery.ts        storeUpload, readFileForActor, submitTicket, evaluateTicket
 *  - src/server/sprint-end.ts      beginSprintClose, getSprintEndView, decideSprintEnd, closeSprint
 *  - src/server/scheduler.ts       runScheduledTick
 * Tüm servisler (db, actor, input, now = new Date()) alır; `now` testlerde zamanı sabitlemek içindir.
 */
import { z } from "zod";
import type { SprintEndOption } from "./sprint-end";
import type { SprintRow, TicketRef, TicketStatus, UserOption } from "./plan";

/* ------------------------------------------------------------------ */
/* Sabitler ve durum grupları                                          */
/* ------------------------------------------------------------------ */

/** Cevapsız teklif bu kadar dakika sonra hak düşmeden havuza döner. */
export const OFFER_MINUTES = 30;
export const MAX_SUBMISSION_LINKS = 10;
export const MAX_SUBMISSION_FILES = 5;
/** Ek süre onayında verilebilecek en fazla saat. */
export const MAX_GRANTED_HOURS = 24 * 14;

/** Ticket kişide ve iş sürüyor (geri sayım işliyor ya da talep yüzünden duruyor). */
export const IN_PROGRESS_STATUSES = ["taken", "extension_pending", "withdrawal_pending"] as const satisfies readonly TicketStatus[];

/** Teslim edilebilen durumlar (submitted: yeniden teslim; en sonuncusu geçerli). */
export const SUBMITTABLE_STATUSES = [...IN_PROGRESS_STATUSES, "submitted"] as const satisfies readonly TicketStatus[];

/** Değerlendirilebilen durumlar. */
export const EVALUABLE_STATUSES = ["submitted", "evaluated"] as const satisfies readonly TicketStatus[];

/** Sprint sonunda "bitmiş" sayılanlar; geri kalan her şey (taslak dahil) karar bekler. */
export const SPRINT_DONE_STATUSES = ["submitted", "evaluated", "cancelled"] as const satisfies readonly TicketStatus[];

export const isInProgress = (s: TicketStatus) => (IN_PROGRESS_STATUSES as readonly string[]).includes(s);
export const isSubmittable = (s: TicketStatus) => (SUBMITTABLE_STATUSES as readonly string[]).includes(s);
export const isEvaluable = (s: TicketStatus) => (EVALUABLE_STATUSES as readonly string[]).includes(s);
export const isSprintDone = (s: TicketStatus) => (SPRINT_DONE_STATUSES as readonly string[]).includes(s);

export type RequestKind = "extension" | "withdrawal";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type Verdict = "good" | "bad";

/** Talep bekliyorken ticket'ın durumu. */
export const PENDING_STATUS_FOR: Record<RequestKind, TicketStatus> = {
  extension: "extension_pending",
  withdrawal: "withdrawal_pending",
};

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  extension: "Ek süre",
  withdrawal: "Geri çekme",
};
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Bekliyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  cancelled: "Geri alındı",
};
export const VERDICT_LABELS: Record<Verdict, string> = { good: "İyi oldu", bad: "Kötü oldu" };

/* ------------------------------------------------------------------ */
/* Girdi şemaları                                                      */
/* ------------------------------------------------------------------ */

const id = z.uuid();
const note = z.string().trim().max(2000, "En fazla 2000 karakter.");

export const ticketRefSchema = z.object({ ticketId: id });
export const requestRefSchema = z.object({ requestId: id });

export const createRequestSchema = z.object({
  ticketId: id,
  kind: z.enum(["extension", "withdrawal"]),
  reason: z.string().trim().min(5, "Sebebini birkaç kelimeyle yaz (en az 5 karakter).").max(2000),
});

export const requestMessageSchema = z.object({
  requestId: id,
  body: z.string().trim().min(1, "Mesaj boş olamaz.").max(4000, "En fazla 4000 karakter."),
});

/** Ek süre onayında grantedHours zorunlu; geri çekme onayında yok sayılır. */
export const approveRequestSchema = z.object({
  requestId: id,
  grantedHours: z.number().int().min(1, "En az 1 saat.").max(MAX_GRANTED_HOURS).optional(),
  note: note.optional(),
});

export const rejectRequestSchema = z.object({ requestId: id, note: note.optional() });

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      const p = new URL(u);
      return p.protocol === "http:" || p.protocol === "https:";
    } catch {
      return false;
    }
  }, "Bağlantı http:// ya da https:// ile başlamalı.");

export const submitTicketSchema = z.object({
  ticketId: id,
  description: z.string().trim().min(5, "Ne yaptığını kısaca anlat (en az 5 karakter).").max(5000),
  links: z.array(httpUrl).max(MAX_SUBMISSION_LINKS, `En fazla ${MAX_SUBMISSION_LINKS} bağlantı.`).default([]),
  fileIds: z.array(id).max(MAX_SUBMISSION_FILES, `En fazla ${MAX_SUBMISSION_FILES} dosya.`).default([]),
  /** Aşama 7.5: teslim edilen PR (ticket'a bağlı `ticket_pull_requests` satırı). Yükleme kapalıyken dosya yok. */
  pullRequestId: id.nullable().default(null),
});

export const evaluateTicketSchema = z.object({
  ticketId: id,
  verdict: z.enum(["good", "bad"]),
  comment: z.string().trim().max(1000, "En fazla 1000 karakter.").optional(),
});

export const sprintEndDecisionSchema = z.object({
  sprintId: id,
  ticketId: id,
  /** SPRINT_END_OPTIONS anahtarlarından biri (sunucu kayıttan doğrular). */
  decision: z.string().min(1),
  note: z.string().trim().max(1000).optional(),
});

/* ------------------------------------------------------------------ */
/* Çıktı tipleri (tarihler ISO metin)                                  */
/* ------------------------------------------------------------------ */

/** Geri sayım: pausedAt doluysa kalan = dueAt - pausedAt (donuk); değilse dueAt - şimdi. */
export type Countdown = { dueAt: string | null; pausedAt: string | null };

export type TicketCard = {
  id: string;
  title: string;
  status: TicketStatus;
  areaId: string;
  areaName: string;
  sprintId: string;
  takenAt: string | null;
  countdown: Countdown;
};

export type OfferView = {
  ticket: TicketCard & { description: string };
  offeredAt: string;
  /** offeredAt + OFFER_MINUTES */
  expiresAt: string;
};

export type RejectionQuota = { used: number; limit: number; remaining: number };

/** requestTicket sonucu. "taken": red hakkı bitmiş kişiye doğrudan atandı. */
export type DrawResult =
  | { kind: "offered"; offer: OfferView; rejections: RejectionQuota }
  | { kind: "taken"; ticket: TicketCard; rejections: RejectionQuota }
  | { kind: "empty"; rejections: RejectionQuota };

export type MyTicketsView = {
  /** Aktif sprint; yoksa ticket istenemez. */
  sprint: { id: string; name: string } | null;
  rejections: RejectionQuota;
  /** Bekleyen teklif (en fazla bir). */
  offer: OfferView | null;
  /** IN_PROGRESS_STATUSES, en yakın bitiş önce. */
  active: TicketCard[];
  /** Son teslim edilen / değerlendirilenler (en yeni önce, en fazla 20). */
  recent: (TicketCard & { verdicts: Verdict[] })[];
};

export type FileRef = { id: string; name: string; mimeType: string; sizeBytes: number };

export type RequestRow = {
  id: string;
  ticketId: string;
  kind: RequestKind;
  status: RequestStatus;
  reason: string;
  requester: UserOption;
  grantedHours: number | null;
  respondedBy: UserOption | null;
  respondedAt: string | null;
  responseNote: string | null;
  respondBy: string;
  awaitingRequesterAt: string | null;
  overdueAt: string | null;
  createdAt: string;
};

export type TicketMessage = {
  id: string;
  kind: "text" | "system";
  author: UserOption | null;
  body: string;
  requestId: string | null;
  createdAt: string;
};

export type SubmissionRow = {
  id: string;
  user: UserOption;
  description: string;
  links: string[];
  files: FileRef[];
  createdAt: string;
  /** Aşama 7.5: teslim edilen PR. */
  pullRequest?: { number: number; url: string; title: string; merged: boolean } | null;
};

export type EvaluationRow = {
  id: string;
  evaluator: UserOption;
  verdict: Verdict;
  comment: string | null;
  submissionId: string | null;
  createdAt: string;
};

export type TicketPerms = {
  isAssignee: boolean;
  /** Alanın yöneticisi ya da ana yönetici. */
  canManage: boolean;
  /** Teklifi kabul/ret (teklif aktöre yapılmış ve süresi geçmemiş). */
  canAnswerOffer: boolean;
  canRequestExtension: boolean;
  canRequestWithdrawal: boolean;
  canSubmit: boolean;
  canEvaluate: boolean;
  /** Bekleyen talebi onaylama/reddetme (yönetebilir ve talep sahibi değil). */
  canRespond: boolean;
  /** Bekleyen talebin konuşmasına yazabilir (talep sahibi ya da cevaplayabilen). */
  canMessage: boolean;
  /** Bekleyen talebini geri alabilir (talep sahibi). */
  canCancelRequest: boolean;
};

export type TicketDetail = {
  ticket: TicketCard & {
    description: string;
    sprintName: string;
    assignee: UserOption | null;
    offeredAt: string | null;
    offerExpiresAt: string | null;
  };
  prerequisites: TicketRef[];
  /** En yeni önce. */
  requests: RequestRow[];
  /** Bekleyen talep varsa. */
  pendingRequest: RequestRow | null;
  /** Ticket konuşması (talep mesajları + sistem mesajları), eskiden yeniye. */
  messages: TicketMessage[];
  /** En yeni önce; ilki geçerli teslim. */
  submissions: SubmissionRow[];
  evaluations: EvaluationRow[];
  rejections: RejectionQuota | null;
  perms: TicketPerms;
  limits: { uploadMaxMb: number; maxLinks: number; maxFiles: number; maxGrantedHours: number };
};

export type TrackingRow = TicketCard & {
  assignee: UserOption | null;
  pendingRequest: { id: string; kind: RequestKind; overdue: boolean } | null;
  lastSubmittedAt: string | null;
  verdicts: Verdict[];
};

/** Talep listeleri (alan takibi ve /yonetim/talepler). */
export type OpenRequestRow = RequestRow & {
  ticket: { id: string; title: string; areaId: string; areaName: string; countdown: Countdown };
};

export type AreaTrackingView = {
  area: { id: string; name: string };
  sprint: SprintRow | null;
  counts: { draft: number; pool: number; offered: number; inProgress: number; submitted: number; evaluated: number; cancelled: number };
  /** IN_PROGRESS_STATUSES + offered. */
  inProgress: TrackingRow[];
  /** Bu alandaki bekleyen talepler, cevapsızlar önce. */
  pendingRequests: OpenRequestRow[];
  /** submitted (değerlendirme bekleyen) önce, sonra evaluated. */
  toEvaluate: TrackingRow[];
};

export type SprintEndItem = {
  ticket: TicketCard & { assignee: UserOption | null };
  /** Bu ticket'ın durumuna uygulanabilen seçenek anahtarları. */
  allowedOptions: string[];
  /** Aktör bu ticket için karar verebilir mi (alanın yöneticisi ya da ana yönetici). */
  canDecide: boolean;
  decision: { key: string; label: string; note: string | null; decidedBy: UserOption; createdAt: string } | null;
};

export type SprintEndView = {
  sprint: SprintRow;
  /** Taşıma hedefi; yoksa needsNextSprint seçenekleri kullanılamaz. */
  nextSprint: SprintRow | null;
  options: SprintEndOption[];
  /** Aktörün görebildiği bitmemiş ticket'lar (alan yöneticisi: kendi alanları; ana yönetici: tümü). */
  items: SprintEndItem[];
  /** Tüm sprintte kararsız bitmemiş ticket sayısı. */
  undecidedTotal: number;
  /** Ana yönetici ve undecidedTotal = 0. */
  canClose: boolean;
};
