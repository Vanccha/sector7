"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptOfferAction, rejectOfferAction } from "@/app/(app)/actions";
import { GITHUB_REQUIRED_MESSAGE } from "@/lib/contracts/github";
import type { OfferView, RejectionQuota } from "@/lib/contracts/tickets";
import { Countdown } from "./Countdown";
import { ACCEPT_FX_MS, playAcceptFx, prefersReducedMotion } from "./SparkFx";
import styles from "./tickets.module.css";

export function QuotaText({ q }: { q: RejectionQuota }) {
  return (
    <p className={styles.quota}>
      Red hakkı: {q.remaining}/{q.limit}
    </p>
  );
}

/**
 * Teklif kartı: kabul / ret. Son red hakkı kullanılırken önce uyarı gösterilir.
 * onRejected verilirse ret sonrası üst bileşen kartı kapatır; verilmezse sayfa yenilenir.
 */
export function OfferCard({
  offer,
  rejections,
  onRejected,
  stayOnAccept = false,
  heading = true,
}: {
  offer: OfferView;
  rejections: RejectionQuota;
  onRejected?: (q: RejectionQuota) => void;
  /** true: kabulden sonra aynı sayfada kal (ticket sayfası). */
  stayOnAccept?: boolean;
  heading?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [taken, setTaken] = useState(false);
  const t = offer.ticket;
  const canReject = rejections.remaining > 0;
  const last = rejections.remaining === 1;

  function accept() {
    setError(null);
    start(async () => {
      const res = await acceptOfferAction({ ticketId: t.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const go = () => (stayOnAccept ? router.refresh() : router.push(`/ticket/${t.id}`));
      setTaken(true);
      playAcceptFx("Ticket alındı, geri sayım başladı.");
      // Kıvılcım efekti ~800ms, sonra yönlendirme (azaltılmış harekette anında).
      if (prefersReducedMotion()) go();
      else setTimeout(go, ACCEPT_FX_MS);
    });
  }
  function reject() {
    setError(null);
    start(async () => {
      const res = await rejectOfferAction({ ticketId: t.id });
      if (res.ok) {
        setConfirming(false);
        if (onRejected) onRejected(res.data);
        else router.refresh();
      } else setError(res.error);
    });
  }

  return (
    <article className={`cut-panel cut-panel--raised ${styles.card}`} aria-label="Gelen teklif">
      {heading ? <h2 className="panel-h">Sana bir ticket önerildi</h2> : null}
      <h3 className={`h-wide ${styles.title}`}>{t.title}</h3>
      <div className={styles.meta}>
        <span>{t.areaName}</span>
        <span>
          Teklifin kalan süresi: <Countdown countdown={{ dueAt: offer.expiresAt, pausedAt: null }} size="sm" warnBeforeHours={0.1} />
        </span>
      </div>
      {t.description ? <p className={styles.desc}>{t.description}</p> : null}
      <QuotaText q={rejections} />
      {taken ? (
        <p className={styles.taken}>Ticket alındı. Geri sayım başladı.</p>
      ) : confirming ? (
        <div className="notice" role="alert">
          Bu son red hakkın; bundan sonra gelen ticket doğrudan sende olacak.
          <div className={styles.actions} style={{ marginTop: 10 }}>
            <button type="button" className="btn-line" onClick={reject} disabled={pending}>
              Yine de reddet
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button type="button" className="btn-solid" onClick={accept} disabled={pending}>
            Kabul et
          </button>
          {canReject ? (
            <button type="button" className="btn-line" onClick={() => (last ? setConfirming(true) : reject())} disabled={pending}>
              Reddet
            </button>
          ) : null}
        </div>
      )}
      {!canReject && !taken ? <p className="hint">Bu sprintte red hakkın kalmadı.</p> : null}
      <p role="alert" className="field-error" hidden={!error}>
        {error}
        {error === GITHUB_REQUIRED_MESSAGE && (
          <>
            {" "}
            <Link href="/profil">GitHub hesabını bağla</Link>
          </>
        )}
      </p>
    </article>
  );
}
