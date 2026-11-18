/**
 * Sprint sonu karar seçenekleri — SÖZLEŞME.
 * Seçenekler ileride değişebilir: yeni seçenek bu kayda, uygulayıcısı src/server/sprint-end.ts
 * içindeki HANDLERS kaydına eklenir. Veritabanında `decision` metin olarak tutulur.
 */
import type { TicketStatus } from "./plan";

export type SprintEndOption = {
  key: string;
  label: string;
  description: string;
  /** Bu seçeneğin uygulanabildiği ticket durumları. */
  appliesTo: readonly TicketStatus[];
  /** Hedef (sonraki) sprint gerektirir mi. */
  needsNextSprint: boolean;
};

const ALL_UNFINISHED = [
  "draft",
  "available",
  "returned_to_pool",
  "offered",
  "taken",
  "extension_pending",
  "withdrawal_pending",
] as const satisfies readonly TicketStatus[];

const HELD = ["taken", "extension_pending", "withdrawal_pending"] as const satisfies readonly TicketStatus[];

export const SPRINT_END_OPTIONS = [
  {
    key: "move_next",
    label: "Sonraki sprinte taşı",
    description: "Ticket sonraki sprinte geçer, durumu aynen kalır.",
    appliesTo: ALL_UNFINISHED,
    needsNextSprint: true,
  },
  {
    key: "keep_assignee",
    label: "Aynı kişide bırak",
    description: "Ticket aynı kişide kalır, sonraki sprinte geçer ve süresi yeniden başlar.",
    appliesTo: HELD,
    needsNextSprint: true,
  },
  {
    key: "return_pool",
    label: "Havuza geri koy",
    description: "Ticket kişiden alınır ve sonraki sprintin havuzuna döner.",
    appliesTo: HELD,
    needsNextSprint: true,
  },
  {
    key: "cancel",
    label: "İptal et",
    description: "Ticket iptal edilir.",
    appliesTo: ALL_UNFINISHED,
    needsNextSprint: false,
  },
] as const satisfies readonly SprintEndOption[];

export type SprintEndDecisionKey = (typeof SPRINT_END_OPTIONS)[number]["key"];

export function findSprintEndOption(key: string): SprintEndOption | undefined {
  return SPRINT_END_OPTIONS.find((o) => o.key === key);
}

/** Durumu için uygulanabilen seçenekler. */
export function optionsFor(status: TicketStatus): SprintEndOption[] {
  return SPRINT_END_OPTIONS.filter((o) => (o.appliesTo as readonly string[]).includes(status));
}
