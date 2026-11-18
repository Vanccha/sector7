/**
 * Bildirim türleri — SÖZLEŞME. Kişi her türü ayrı kapatabilir (notification_prefs; arayüz Aşama 4).
 * Aşama 3'te yalnız uygulama içi kayıt yazılır (src/lib/notify.ts); push ve gerçek zaman Aşama 4.
 */
export const NOTIFICATION_TYPES = [
  "ticket_due_soon",
  "ticket_expired",
  "ticket_assigned",
  "request_new",
  "request_reminder",
  "request_overdue",
  "request_answered",
  "request_message",
  "ticket_submitted",
  "ticket_evaluated",
  "sprint_closing",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  ticket_due_soon: "Ticket süresi azaldı",
  ticket_expired: "Ticket süresi doldu",
  ticket_assigned: "Ticket sana atandı / geri alındı",
  request_new: "Yeni ek süre / geri çekme talebi",
  request_reminder: "Talep cevap hatırlatması",
  request_overdue: "Cevapsız talep",
  request_answered: "Talebin cevaplandı",
  request_message: "Talep konuşmasında yeni mesaj",
  ticket_submitted: "Alanına teslim geldi",
  ticket_evaluated: "Teslimin değerlendirildi",
  sprint_closing: "Sprint kapanıyor, karar bekleyen ticket'lar",
};

export type NotificationInput = {
  /** Tekrarlar ve null'lar yok sayılır. */
  userIds: (string | null | undefined)[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
};
