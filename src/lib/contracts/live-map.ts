/**
 * Canlı çalışma haritası (Aşama 7.3) — SÖZLEŞME.
 * Herkes görür. Kim şu an hangi alanın ticket'ı üzerinde çalışıyor: alanlar ve kişiler düğüm, sürmekte olan
 * ticket'lar (IN_PROGRESS_STATUSES) kişi → alan bağlantısı. Kişisel veri (e-posta, telefon) YOK.
 * Atama/kapasite/yük hesabı yok; düğüm sayısı değişken.
 */
import type { TicketStatus } from "./plan";

export type LiveMapArea = {
  id: string;
  name: string;
  archived: boolean;
  /** Bu alandaki sürmekte olan ticket sayısı. */
  activeCount: number;
  /** Alan yöneticisinin adı (yalnız ad; yönetici yoksa ya da pasifse null). Altıgenin içinde gösterilir. */
  managerName: string | null;
};

export type LiveMapPerson = {
  id: string;
  name: string;
  /** Ana alanı (yoksa null). */
  homeAreaId: string | null;
};

export type LiveMapLink = {
  ticketId: string;
  title: string;
  areaId: string;
  userId: string;
  status: TicketStatus;
  takenAt: string | null; // ISO
  /** Geri sayım duruyor mu (talep bekliyor). */
  paused: boolean;
};

export type LiveMap = {
  /** Arşivsiz tüm alanlar + bağlantısı olan arşivli alanlar. Ad sırasıyla. */
  areas: LiveMapArea[];
  /** Yalnız en az bir sürmekte olan ticket'ı olan aktif kişiler. Ad sırasıyla. */
  people: LiveMapPerson[];
  links: LiveMapLink[];
  generatedAt: string; // ISO
};

/** Düğüm şekli — geliştirici kararı: kesik köşeli altıgen. Değiştirmek için yalnız bu sabit. */
export const NODE_SHAPES = ["hex", "tri", "cut-square"] as const;
export type NodeShape = (typeof NODE_SHAPES)[number];
export const DEFAULT_NODE_SHAPE: NodeShape = "hex";
