"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./install.module.css";
import { useInstall } from "./install-store";

function IconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconShare() {
  return (
    <svg
      className={styles.shareIcon}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      role="img"
      aria-label="Paylaş simgesi"
    >
      <path d="M12 15V4M8 8l4-4 4 4M6 11H5v9h14v-9h-1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IosHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={(e) => {
        // Esc yalnız bu paneli kapatsın (Menü sayfası açık kalabilir).
        if (e.key === "Escape") e.nativeEvent.stopPropagation();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className={styles.dialogBody}>
        <h2 id={titleId} className={styles.dialogTitle}>
          Ana ekrana ekle
        </h2>
        <ol className={styles.steps}>
          <li>
            Safari&apos;de alttaki <IconShare /> Paylaş simgesine dokun.
          </li>
          <li>&quot;Ana Ekrana Ekle&quot; seçeneğini seç.</li>
          <li>Sağ üstte &quot;Ekle&quot;ye dokun.</li>
        </ol>
        <button type="button" className={styles.yes} autoFocus onClick={() => ref.current?.close()}>
          Tamam
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

export function InstallButton({ variant }: { variant: "header" | "menu" }) {
  const { state, install } = useInstall();
  const [help, setHelp] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  if (state !== "native" && state !== "ios") return null;

  function onClick() {
    if (state === "native") void install();
    else setHelp(true);
  }

  function closeHelp() {
    setHelp(false);
    btnRef.current?.focus();
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={variant === "header" ? `${styles.btn} ${styles.header}` : `menu-sheet__link ${styles.menu}`}
        aria-haspopup={state === "ios" ? "dialog" : undefined}
        onClick={onClick}
      >
        <IconDownload />
        <span>Uygulamayı yükle</span>
      </button>
      {help && <IosHelp onClose={closeHelp} />}
    </>
  );
}
