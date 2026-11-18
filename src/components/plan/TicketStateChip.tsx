import { TICKET_STATUS_LABELS, isInPool, type TicketStatus } from "@/lib/contracts/plan";
import styles from "./plan.module.css";

/**
 * Ticket durum çipi: Taslak / Bekliyor · N ön koşul / Alınabilir / Alındı / Teslim edildi / İptal.
 * "Alınabilir" vurgu rengiyle; bekleyenin başlığına ön koşul adları ipucu olarak eklenebilir.
 */
export function ticketStateLabel(status: TicketStatus, takeable: boolean, blockedCount: number, short = false): string {
  if (isInPool(status)) {
    if (takeable) return "Alınabilir";
    if (blockedCount > 0) return short ? `Bekliyor · ${blockedCount}` : `Bekliyor · ${blockedCount} ön koşul`;
  }
  return TICKET_STATUS_LABELS[status];
}

export function TicketStateChip({
  status,
  takeable,
  blockedCount,
  hint,
  short,
}: {
  status: TicketStatus;
  takeable: boolean;
  blockedCount: number;
  hint?: string;
  short?: boolean;
}) {
  const tone = isInPool(status) && takeable ? "take" : isInPool(status) && blockedCount > 0 ? "wait" : "plain";
  return (
    <span className={styles.stateChip} data-tone={tone} title={hint}>
      {ticketStateLabel(status, takeable, blockedCount, short)}
    </span>
  );
}
