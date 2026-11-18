/**
 * Bildirim türleri — SÖZLEŞME. Kişi her türü uygulama içi ve push için ayrı ayrı kapatabilir (notification_prefs;
 * satır yoksa ikisi de açık). notify() uygulama içi kaydı yazar ve gerçek zaman olayı yayınlar; push gönderimini
 * uygulama sürecindeki dağıtıcı (src/server/push.ts) `notifications.pushedAt` kuyruğundan yapar.
 * Tercih kuralı (src/lib/notify.ts):
 *  - inApp=false ve push=false → satır yazılmaz.
 *  - inApp=false ve push=true  → satır push kuyruğu için yazılır, `readAt` dolu doğar (rozet/sayaç artmaz).
 *  - push=false → satır `pushedAt` dolu doğar (kuyruğa girmez).
 */
import { z } from "zod";

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
  "announcement",
  "ticket_message",
  "mention",
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
  announcement: "Yeni duyuru",
  ticket_message: "Ticket konuşmasında yeni mesaj",
  mention: "Biri senden bahsetti (@kullanıcıadı)",
};

/* ------------------------------------------------------------------ */
/* Bildirim listesi, tercihler, push (Aşama 4)                         */
/* Uygulama: src/server/notifications.ts, src/server/push.ts           */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_PAGE_SIZE = 30;

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationListView = {
  items: NotificationView[];
  unread: number;
  /** Sonraki sayfa için son öğenin kimliği; yoksa null. */
  nextCursor: string | null;
};

export type NotificationPref = { type: NotificationType; label: string; inApp: boolean; push: boolean };

export type NotificationSettingsView = {
  prefs: NotificationPref[];
  push: {
    /** Sunucuda VAPID anahtarları tanımlı mı. */
    available: boolean;
    /** Tarayıcıya verilecek VAPID public key (available değilse null). */
    publicKey: string | null;
    /** Kişinin kayıtlı cihaz (abonelik) sayısı. */
    deviceCount: number;
  };
};

const notificationType = z.enum(NOTIFICATION_TYPES);

export const listNotificationsSchema = z.object({
  cursor: z.uuid().nullable().default(null),
  onlyUnread: z.boolean().default(false),
});

/** ids boşsa tümünü okundu yapar. */
export const markNotificationsReadSchema = z.object({ ids: z.array(z.uuid()).max(200).default([]) });

export const setNotificationPrefsSchema = z.object({
  prefs: z
    .array(z.object({ type: notificationType, inApp: z.boolean(), push: z.boolean() }))
    .min(1)
    .max(NOTIFICATION_TYPES.length),
});

/** Tarayıcının PushSubscription.toJSON() çıktısı. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000).refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "Geçersiz push adresi."),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(4).max(200) }),
});

export const pushEndpointSchema = z.object({ endpoint: z.string().max(2000) });

/** Push bildirimi yükü (service worker `push` olayında JSON). */
export type PushPayload = { title: string; body: string; link: string | null; tag: string };

export type NotificationInput = {
  /** Tekrarlar ve null'lar yok sayılır. */
  userIds: (string | null | undefined)[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
};
