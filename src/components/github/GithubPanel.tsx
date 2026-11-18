"use client";
import { useRef, useState, useTransition } from "react";
import { retryGithubSyncAction } from "@/app/(app)/ticket/[ticketId]/actions";
import type { TicketGithubView } from "@/lib/contracts/github";
import { PrState } from "./PrState";
import styles from "./GithubPanel.module.css";

/** Ticket sayfası yan sütunu: issue, iş dalı, PR'lar ve teslime hazır ipucu. Otomatik teslim yoktur. */
export function GithubPanel({ ticketId, view }: { ticketId: string; view: TicketGithubView }) {
  const [copied, setCopied] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const command = view.branch ? `git fetch && git switch ${view.branch}` : "";

  async function copy() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(command);
      setCopied("Komut kopyalandı.");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(""), 3000);
    } catch {
      setCopyFailed(true);
    }
  }

  function retry() {
    setRetryMsg(null);
    start(async () => {
      const r = await retryGithubSyncAction({ ticketId });
      setRetryMsg(r.ok ? "Yeniden denenecek; birazdan sayfayı yenile." : r.error);
    });
  }

  return (
    <section className={`cut-panel ${styles.panel}`} aria-labelledby="github-h">
      <h2 className="panel-h" id="github-h">
        GitHub
      </h2>

      {view.repo ? <p className={styles.small}>Depo: {view.repo}</p> : null}

      {view.issueUrl ? (
        <a className={styles.link} href={view.issueUrl} target="_blank" rel="noopener noreferrer">
          Issue&apos;yu GitHub&apos;da aç
        </a>
      ) : (
        <p className={styles.small}>Issue henüz açılmadı.</p>
      )}

      {view.branch ? (
        <div className={styles.block}>
          <h3 className={styles.h3}>İş dalı</h3>
          {view.branchUrl ? (
            <a className={`${styles.link} ${styles.code}`} href={view.branchUrl} target="_blank" rel="noopener noreferrer">
              {view.branch}
            </a>
          ) : (
            <code className={styles.code}>{view.branch}</code>
          )}
          <button type="button" className="btn-line" onClick={copy} aria-describedby="github-copy-status">
            Dala geçme komutunu kopyala
          </button>
          <p id="github-copy-status" className={styles.small} role="status" aria-live="polite">
            {copied}
            {copyFailed ? `Kopyalanamadı; elle kopyala: ${command}` : ""}
          </p>
        </div>
      ) : null}

      <div className={styles.block}>
        <h3 className={styles.h3}>Çekme istekleri</h3>
        {view.pullRequests.length === 0 ? (
          <p className={styles.small}>Henüz PR yok.</p>
        ) : (
          <ul className={styles.list}>
            {view.pullRequests.map((pr) => (
              <li key={pr.id} className={styles.pr}>
                <a className={styles.link} href={pr.url} target="_blank" rel="noopener noreferrer">
                  #{pr.number} {pr.title}
                </a>
                <PrState pr={pr} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {view.readyToSubmit ? (
        <p className={`notice notice--ok ${styles.hint}`}>
          <strong>Teslime hazır</strong> — teslim formunda bu PR&apos;ı seç. PR&apos;ın birleşmesi ticket&apos;ı kendiliğinden
          teslim etmez; teslimi sen yaparsın.
        </p>
      ) : null}

      {view.syncPending && !view.syncError ? <p className={styles.small}>GitHub senkronu bekliyor.</p> : null}

      {view.syncError ? (
        <div className={`notice notice--hot ${styles.hint}`}>
          <p style={{ margin: 0 }}>GitHub senkronu tamamlanamadı: {view.syncError}</p>
          <button type="button" className="btn-line" onClick={retry} disabled={pending}>
            Yeniden dene
          </button>
          <p role="status" aria-live="polite" className={styles.small}>
            {retryMsg}
          </p>
        </div>
      ) : null}
    </section>
  );
}
