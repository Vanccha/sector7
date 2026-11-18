/**
 * Sprint sonu karar seçenekleri — SÖZLEŞME (Aşama 3'te uygulanır).
 * Seçenekler ileride değişebilir: yeni seçenek bu kayda eklenir, veritabanında `decision` metin olarak tutulur.
 */
export type SprintEndOption = {
  key: string;
  label: string;
  description: string;
};

export const SPRINT_END_OPTIONS = [
  { key: "move_next", label: "Sonraki sprinte taşı", description: "Ticket sonraki sprinte geçer." },
  { key: "keep_assignee", label: "Aynı kişide bırak", description: "Ticket aynı kişide kalır, süresi yeniden başlar." },
  { key: "return_pool", label: "Havuza geri koy", description: "Ticket kişiden alınır, havuza döner." },
  { key: "cancel", label: "İptal et", description: "Ticket iptal edilir." },
] as const satisfies readonly SprintEndOption[];

export type SprintEndDecisionKey = (typeof SPRINT_END_OPTIONS)[number]["key"];
