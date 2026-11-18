/**
 * Gerçek zaman olayları — SÖZLEŞME.
 * Yol: yazma işlemi transaction içinde `pg_notify(REALTIME_CHANNEL, json)` çağırır (NOTIFY yalnız commit'te
 * teslim edilir) → uygulama sürecindeki tek LISTEN bağlantısı (src/server/realtime/hub.ts) olayları dağıtır →
 * `GET /api/olaylar` (Server-Sent Events) her bağlantıya, aktörün görebildiklerini süzerek yollar.
 * Yük (payload) 8000 baytı geçmemeli: yalnız kimlikler taşınır, içerik istemci tarafından ayrıca çekilir.
 */
import type { ChannelKind } from "./messaging";

export const REALTIME_CHANNEL = "sector7_events";

/** Sunucu içi olay (NOTIFY yükü). */
export type ServerEvent =
  | {
      kind: "message";
      channelId: string;
      channelKind: ChannelKind;
      areaId: string | null;
      ticketId: string | null;
      /** Ticket kanalında görme yetkisi süzmesi için ticket'ın (mesaj anındaki) kişisi. */
      ticketAssigneeId: string | null;
      messageId: string;
      authorId: string | null;
    }
  /** Alıcı çoksa (yük sınırı) "all": her bağlı istemci sayacını yeniler. */
  | { kind: "notification"; userIds: string[] | "all" }
  /**
   * Bir ticket'ın durumu ya da kişisi değişti (Aşama 7). Uygulama kodu yayınlamaz: `tickets` tablosundaki
   * `tickets_notify_change` tetikleyicisi (göç 0003) üretir; böylece her yazma yolu kapsanır. Aynı transaction'daki
   * özdeş yükleri PostgreSQL tekilleştirir. Herkese gider (kişisel veri yok); ekranlar içeriği yeniden çeker.
   */
  | { kind: "tickets"; areaId: string };

/** Bu sayıdan fazla alıcıda userIds yerine "all" gönderilir. */
export const NOTIFY_FANOUT_LIMIT = 100;

/** İstemciye giden olay (SSE `data:` satırı JSON). SSE `event:` adı = kind. */
export type ClientEvent =
  | { kind: "message"; channelId: string; messageId: string; authorId: string | null }
  | { kind: "notification" }
  | { kind: "tickets"; areaId: string }
  | { kind: "ready" };
