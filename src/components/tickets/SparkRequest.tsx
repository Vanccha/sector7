"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestTicketAction } from "@/app/(app)/actions";
import type { DrawResult, MyTicketsView, OfferView, RejectionQuota } from "@/lib/contracts/tickets";
import { OfferCard, QuotaText } from "./OfferCard";
import styles from "./tickets.module.css";

function SparkFx({ on }: { on: boolean }) {
  return (
    <svg className={`${styles.fx} ${on ? styles.fxOn : ""}`} viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <circle className={styles.ring} cx="100" cy="40" r="26" />
      <polyline className={styles.glow} points="10,40 60,18 80,44 120,12 150,46 190,30" />
      <polyline className={styles.bolt} points="10,40 60,18 80,44 120,12 150,46 190,30" />
      <polyline className={styles.branch} points="80,44 96,66 118,58" />
      <polyline className={styles.branch} points="120,12 138,4 156,10" />
      <polyline className={styles.branch} points="60,18 46,6 30,8" />
      <circle className={`${styles.dot} ${styles.dot1}`} cx="60" cy="18" r="4" />
      <circle className={`${styles.dot} ${styles.dot2}`} cx="120" cy="12" r="3" />
      <circle className={`${styles.dot} ${styles.dot3}`} cx="150" cy="46" r="4" />
    </svg>
  );
}

/** Ana sayfadaki "Kıvılcım çak" akışı: teklif kartı, red hakkı uyarıları, sonuç mesajları. */
export function SparkRequest({ initial }: { initial: MyTicketsView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [offer, setOffer] = useState<OfferView | null>(initial.offer);
  const [quota, setQuota] = useState<RejectionQuota>(initial.rejections);
  const [warn, setWarn] = useState(false);
  const [fx, setFx] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noSprint = !initial.sprint;

  function draw() {
    setError(null);
    setMessage(null);
    setRejected(false);
    setWarn(false);
    setFx(true);
    if (fxTimer.current) clearTimeout(fxTimer.current);
    fxTimer.current = setTimeout(() => setFx(false), 1000);
    start(async () => {
      const res = await requestTicketAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const r: DrawResult = res.data;
      setQuota(r.rejections);
      if (r.kind === "offered") setOffer(r.offer);
      else if (r.kind === "taken") router.push(`/ticket/${r.ticket.id}`);
      else setMessage("Şu an alınabilir ticket yok. Biraz sonra tekrar deneyebilirsin.");
    });
  }

  function onClick() {
    if (quota.remaining <= 0 && !warn) {
      setWarn(true);
      return;
    }
    draw();
  }

  if (offer) {
    return (
      <div className={styles.drop}>
        <OfferCard
          offer={offer}
          rejections={quota}
          onRejected={(q) => {
            setQuota(q);
            setOffer(null);
            setRejected(true);
            setMessage("Teklif kapandı. Hazır olduğunda yenisini isteyebilirsin.");
          }}
        />
      </div>
    );
  }

  return (
    <section className="cut-panel cut-panel--raised" style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="spark-h">
      <h2 className="panel-h" id="spark-h">
        Ticket iste
      </h2>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {noSprint
          ? "Şu an aktif bir sprint yok; sprint başladığında buradan ticket isteyebilirsin."
          : "Kıvılcım çaktığında ana alanın dışından rastgele bir ticket önerilir. Kabul edersen geri sayım başlar."}
      </p>
      <QuotaText q={quota} />
      {warn ? (
        <div className="notice notice--hot" role="alert">
          Red hakkın kalmadı; gelen ticket doğrudan sende olacak.
          <div className={styles.actions} style={{ marginTop: 10 }}>
            <button type="button" className="btn-solid" onClick={draw} disabled={pending}>
              Anladım, devam et
            </button>
            <button type="button" className="btn-ghost" onClick={() => setWarn(false)} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <span className={`${styles.sparkWrap} ${pending ? styles.sparkBusy : ""}`}>
            <button type="button" className="btn-solid" onClick={onClick} disabled={noSprint || pending} aria-busy={pending}>
              {pending ? "Kıvılcım çakılıyor…" : rejected ? "Yenisini iste" : "Kıvılcım çak"}
            </button>
            <SparkFx on={fx} />
          </span>
          <Link href="/ticketlarim" className={`btn-ghost ${styles.linkBtn}`}>
            Ticket&apos;larım
          </Link>
        </div>
      )}
      <p role="status" aria-live="polite" className="muted" style={{ margin: 0, fontSize: 14 }}>
        {message}
      </p>
      <p role="alert" className="field-error" hidden={!error}>
        {error}
      </p>
    </section>
  );
}
