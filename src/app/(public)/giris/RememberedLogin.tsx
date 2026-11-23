"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import styles from "../public.module.css";
import login from "./Login.module.css";

export type RememberedAccount = { name: string; username: string };

const SERVER_ERROR = "Sunucuda bir sorun var; birazdan tekrar dene.";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : parts.slice(0, 1)).map((p) =>
    p.charAt(0),
  );
  return letters.join("").toLocaleUpperCase("tr-TR") || "?";
}

export function RememberedLogin({
  account,
  onUseForm,
}: {
  account: RememberedAccount;
  /** Normal forma geç (isteğe bağlı nötr bilgi notuyla). */
  onUseForm: (message?: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"signin" | "forget" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy("signin");
    setError(null);
    try {
      const res = await authClient.$fetch<{ ok: boolean }>("/remembered-device/sign-in", { method: "POST", body: {} });
      if (res.error) {
        setError(res.error.status === 429 ? "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene." : SERVER_ERROR);
        setBusy(null);
        return;
      }
      if (!res.data?.ok) {
        // Nedeni (süre, pasif hesap, geçersiz token) gösterilmez.
        onUseForm("Kullanıcı adın ve şifrenle giriş yap.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(SERVER_ERROR);
      setBusy(null);
    }
  }

  async function useAnother() {
    setBusy("forget");
    setError(null);
    try {
      await authClient.$fetch("/remembered-device/forget", { method: "POST", body: {} });
    } catch {
      // Çerez sunucuda silinemese bile form gösterilir; sonraki girişte eski kayıt temizlenir.
    }
    onUseForm();
  }

  return (
    <section className={`cut-panel cut-panel--raised ${styles.card} ${login.remembered}`} aria-labelledby="giris-h">
      <h1 id="giris-h" className="sr-only">
        Giriş yap
      </h1>
      <div className={login.avatar} aria-hidden="true">
        {initials(account.name)}
      </div>
      <div className={login.who}>
        <p className={`h-wide ${login.name}`}>{account.name}</p>
        <p className={`muted ${login.handle}`}>@{account.username}</p>
      </div>
      <div aria-live="polite" className={login.alert}>
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        className="btn-solid btn-block"
        onClick={signIn}
        disabled={busy !== null}
        aria-busy={busy === "signin"}
        // Hatırlanan görünümde Enter doğrudan giriş yapsın.
        autoFocus
      >
        {busy === "signin" ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
      <button type="button" className="btn-ghost btn-block" onClick={useAnother} disabled={busy !== null}>
        Başka bir hesapla giriş yap
      </button>
    </section>
  );
}
