"use client";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth/client";
import type { GithubLink } from "@/lib/contracts/github";
import { unlinkGithubAction } from "./actions";
import styles from "./Profile.module.css";

const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" });

const ERRORS: Record<string, string> = {
  account_already_linked_to_different_user: "Bu GitHub hesabı başka bir SECTOR7 hesabına bağlı. Farklı bir GitHub hesabıyla dene.",
  "account already linked to different user": "Bu GitHub hesabı başka bir SECTOR7 hesabına bağlı. Farklı bir GitHub hesabıyla dene.",
  unable_to_link_account:
    "GitHub hesabı bağlanamadı: bu hesap başka bir SECTOR7 hesabına bağlı olabilir ya da GitHub'a şu an ulaşılamıyor.",
  access_denied: "GitHub izni verilmedi, bağlantı kurulmadı. İstersen yeniden deneyebilirsin.",
};
const GENERIC_ERROR = "GitHub hesabı şu an bağlanamadı. Biraz sonra yeniden dener misin?";

function GithubMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function GithubCard({ enabled, link, errorCode }: { enabled: boolean; link: GithubLink; errorCode: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(errorCode ? (ERRORS[errorCode] ?? GENERIC_ERROR) : null);
  const [confirming, setConfirming] = useState(false);
  const [removed, setRemoved] = useState(false);
  const current = removed ? null : link;

  function connect() {
    setError(null);
    start(async () => {
      try {
        const res = await authClient.linkSocial({ provider: "github", callbackURL: "/profil", errorCallbackURL: "/profil" });
        if (res.error) setError(ERRORS[res.error.code ?? ""] ?? GENERIC_ERROR);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function unlink() {
    setError(null);
    start(async () => {
      const res = await unlinkGithubAction();
      if (res.ok) {
        setRemoved(true);
        setConfirming(false);
      } else setError(res.error);
    });
  }

  return (
    <section className={`cut-panel ${styles.card}`} aria-labelledby="gh-h">
      <h2 id="gh-h" className="panel-h">
        GitHub hesabı
      </h2>
      {!enabled ? (
        <p className={`muted ${styles.text}`}>GitHub bağlantısı henüz etkin değil.</p>
      ) : current ? (
        <>
          <p className={styles.text}>
            <a
              className={styles.login}
              href={`https://github.com/${encodeURIComponent(current.login)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{current.login}
            </a>
          </p>
          <p className={`muted ${styles.text}`}>Bağlanma tarihi: {fmt.format(new Date(current.linkedAt))}</p>
          {confirming ? (
            <div className="notice" role="group" aria-label="Bağlantıyı kaldırma onayı">
              <p className={styles.text}>
                Bağlantı kaldırılırsa yeni ticket kabul etmeden önce hesabını yeniden bağlaman gerekir. Devam edilsin mi?
              </p>
              <div className={styles.actions} style={{ marginTop: 10 }}>
                <button type="button" className="btn-line" onClick={unlink} disabled={pending}>
                  Evet, kaldır
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <button type="button" className="btn-line" onClick={() => setConfirming(true)} disabled={pending}>
                Bağlantıyı kaldır
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className={styles.text}>
            Ticket&apos;lar GitHub üzerinden ilerleyecek. Ticket kabul edebilmek için GitHub hesabını bağlaman gerekiyor. Şifren ya da
            erişim anahtarın saklanmaz; yalnız kullanıcı adın okunur.
          </p>
          <div className={styles.actions}>
            <button type="button" className={`btn-solid ${styles.ghBtn}`} onClick={connect} disabled={pending} aria-busy={pending}>
              <GithubMark />
              {pending ? "GitHub'a yönlendiriliyor…" : "GitHub hesabını bağla"}
            </button>
          </div>
        </>
      )}
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
