/**
 * Aşama 4 (İletişim) mesajlaşma sözleşmesi — SÖZLEŞME (teknik lider yazar; alt ajanlar değiştirmez).
 * Geliştirici kararları (2026-11-18):
 *  - Alan kanallarını herkes okur ve yazar (arşivli alanın kanalı salt okunur). Ana yöneticiler her şeyi görür.
 *  - Duyuru kanalını herkes okur; yalnız ana yöneticiler ve `canAnnounce` olanlar yazar.
 *  - Ticket konuşması: ticket'ı görebilenler (üzerindeki kişi + alan yöneticisi + ana yöneticiler).
 *  - Mesajlar düzenlenmez ve silinmez.
 *  - Bildirim üretenler: duyurular, ticket konuşması, @bahsetme. Alan kanalındaki sıradan mesaj yalnız okunmamış sayısını artırır.
 * Uygulama: src/server/messaging.ts (listChannels, getChannelView, listOlderMessages, sendMessage, markChannelRead).
 */
import { z } from "zod";
import type { UserOption } from "./plan";
import type { RequestKind } from "./tickets";
import type { TicketStatus } from "./plan";

export const MESSAGE_MAX = 4000;
export const MESSAGE_PAGE_SIZE = 50;

export type ChannelKind = "area" | "ticket" | "announcement";

export const channelLink = (channelId: string) => `/mesajlar/${channelId}`;

/**
 * Metindeki @kullanıcıadı adayları (küçük harf, tekrarsız). Cümle sonundaki noktalar için
 * hem ham hem sondaki noktaları atılmış hâli döner; sunucu veritabanında var olanları seçer.
 * E-posta gibi "ad@alan" biçimleri sayılmaz (@ öncesi harf/rakam olmamalı).
 */
export function mentionCandidates(body: string): string[] {
  const out = new Set<string>();
  // Sonundaki negatif bakış: 30 karakterden uzun adın ilk 30 karakteri aday sayılmasın.
  const re = /(^|[^a-z0-9_.@])@([a-z0-9_.]{3,30})(?![a-z0-9_])/gi;
  for (const m of body.matchAll(re)) {
    const raw = (m[2] ?? "").toLowerCase();
    out.add(raw);
    const trimmed = raw.replace(/\.+$/, "");
    if (trimmed.length >= 3) out.add(trimmed);
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Girdi şemaları                                                      */
/* ------------------------------------------------------------------ */

const id = z.uuid();

export const sendMessageSchema = z.object({
  channelId: id,
  body: z.string().trim().min(1, "Mesaj boş olamaz.").max(MESSAGE_MAX, `En fazla ${MESSAGE_MAX} karakter.`),
});

export const channelRefSchema = z.object({ channelId: id });

/** Eski mesajlar: `beforeId` mesajından önceki MESSAGE_PAGE_SIZE mesaj. */
export const olderMessagesSchema = z.object({ channelId: id, beforeId: id });

/** Canlı akışta gelen yeni mesajlar: `afterId`'den sonrakiler (en fazla 100). */
export const newerMessagesSchema = z.object({ channelId: id, afterId: id.nullable() });

/* ------------------------------------------------------------------ */
/* Çıktı tipleri (tarihler ISO metin)                                  */
/* ------------------------------------------------------------------ */

export type ChannelSummary = {
  id: string;
  kind: ChannelKind;
  /** Alan adı / ticket başlığı / "Duyurular". */
  name: string;
  areaId: string | null;
  areaName: string | null;
  ticketId: string | null;
  ticketStatus: TicketStatus | null;
  /** Alan arşivli (kanal salt okunur). */
  archived: boolean;
  /** Başkalarının, son okumadan sonra yazdığı mesaj sayısı (sistem mesajları dahil). */
  unread: number;
  lastMessageAt: string | null;
  canWrite: boolean;
};

export type ChannelListView = {
  announcement: ChannelSummary;
  /** Arşivsiz alanlar önce (ada göre), arşivliler sonda. */
  areas: ChannelSummary[];
  /**
   * Aktörün görebildiği ve en az bir mesajı olan ticket konuşmaları, son mesaj yeniden eskiye, en fazla 50.
   * Ana yönetici için de yalnız mesajı olanlar.
   */
  tickets: ChannelSummary[];
  totalUnread: number;
};

export type MessageView = {
  id: string;
  kind: "text" | "system";
  author: UserOption | null;
  body: string;
  /** Ek süre / geri çekme talebine bağlı mesaj. */
  requestId: string | null;
  createdAt: string;
  mine: boolean;
};

export type ChannelView = {
  channel: ChannelSummary;
  /** Eskiden yeniye, en fazla MESSAGE_PAGE_SIZE. */
  messages: MessageView[];
  hasOlder: boolean;
  canWrite: boolean;
  /** Yazamıyorsa kısa açıklama. */
  writeHint: string | null;
  /**
   * Ticket kanalında bekleyen talep varsa ve aktör talep sahibi ya da cevaplayabilen ise:
   * gönderilen mesaj talebe bağlanır (talep konuşması kuralları işler).
   */
  pendingRequest: { id: string; kind: RequestKind } | null;
  /** @bahsetme önerileri için: kanalı okuyabilen kişiler (en fazla 200; alan/duyuru kanalında tüm aktif üyeler). */
  mentionables: UserOption[];
};

export type SendResult = { messageId: string };
