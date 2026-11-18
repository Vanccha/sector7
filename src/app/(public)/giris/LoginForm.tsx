"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth/client";
import styles from "../public.module.css";

const BAD_CREDENTIALS = "Kullanıcı adı ya da şifre hatalı.";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.username({
        username: String(fd.get("username") ?? "").trim().toLowerCase(),
        password: String(fd.get("password") ?? ""),
      });
      if (res.error) {
        const st = res.error.status;
        setError(
          st === 429
            ? "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene."
            : st === 401 || st === 422
              ? BAD_CREDENTIALS
              : "Sunucuda bir sorun var; birazdan tekrar dene.",
        );
        setBusy(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(BAD_CREDENTIALS);
      setBusy(false);
    }
  }

  return (
    <section className={`cut-panel cut-panel--raised ${styles.card}`} aria-labelledby="giris-h">
      <h1 id="giris-h" className="h-wide">
        Giriş yap
      </h1>
      <form onSubmit={onSubmit} noValidate className={styles.form}>
        <div className="field">
          <label className="label" htmlFor="username">
            Kullanıcı adı
          </label>
          <input
            id="username"
            name="username"
            className="input"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">
            Şifre
          </label>
          <input
            id="password"
            name="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div aria-live="polite">
          {error && (
            <p className="notice notice--hot" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="btn-solid btn-block" disabled={busy}>
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
      </form>
      <p className="muted">Şifreni unuttuysan bir ana yöneticiye yaz; sana yeni bir bağlantı verir.</p>
      <p>
        Hesabın yok mu?{" "}
        <Link href="/basvuru" className={styles.link}>
          Başvur
        </Link>
      </p>
    </section>
  );
}
