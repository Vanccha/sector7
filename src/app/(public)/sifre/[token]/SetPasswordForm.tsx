"use client";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import styles from "../../public.module.css";
import { setPasswordAction } from "./actions";

export function SetPasswordForm({
  token,
  name,
  username,
  title,
}: {
  token: string;
  name: string;
  username: string;
  title: string;
}) {
  const [pending, startTransition] = useTransition();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setFields({});
    startTransition(async () => {
      const res = await setPasswordAction({
        token,
        password: String(fd.get("password") ?? ""),
        passwordRepeat: String(fd.get("passwordRepeat") ?? ""),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const f = res.fields ?? {};
        setFields(f);
        setError(Object.keys(f).length ? null : res.error);
      }
    });
  }

  if (done) {
    return (
      <section className={`cut-panel cut-panel--raised ${styles.card}`} aria-labelledby="kayit-h">
        <h1 id="kayit-h" className="h-wide">
          Şifren kaydedildi
        </h1>
        <p className="notice notice--ok" role="status">
          Artık kullanıcı adın ve yeni şifrenle giriş yapabilirsin.
        </p>
        <Link href="/giris" className="btn-solid btn-block">
          Giriş yap
        </Link>
      </section>
    );
  }

  return (
    <section className={`cut-panel cut-panel--raised ${styles.card}`} aria-labelledby="sifre-h">
      <h1 id="sifre-h" className="h-wide">
        {title}
      </h1>
      <p>
        Merhaba {name}. Kullanıcı adın: <strong>@{username}</strong>
      </p>
      <form onSubmit={onSubmit} noValidate className={styles.form}>
        <div className="field">
          <label className="label" htmlFor="password">
            Şifre
          </label>
          <input
            id="password"
            name="password"
            className="input"
            type="password"
            autoComplete="new-password"
            aria-invalid={fields.password ? true : undefined}
            aria-describedby={fields.password ? "password-hint password-err" : "password-hint"}
            required
          />
          <p id="password-hint" className="hint">
            En az 10 karakter.
          </p>
          {fields.password && (
            <p id="password-err" className="field-error">
              {fields.password}
            </p>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="passwordRepeat">
            Şifre (tekrar)
          </label>
          <input
            id="passwordRepeat"
            name="passwordRepeat"
            className="input"
            type="password"
            autoComplete="new-password"
            aria-invalid={fields.passwordRepeat ? true : undefined}
            aria-describedby={fields.passwordRepeat ? "passwordRepeat-err" : undefined}
            required
          />
          {fields.passwordRepeat && (
            <p id="passwordRepeat-err" className="field-error">
              {fields.passwordRepeat}
            </p>
          )}
        </div>
        <div aria-live="polite">
          {error && (
            <p className="notice notice--hot" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="btn-solid btn-block" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Şifreyi kaydet"}
        </button>
      </form>
    </section>
  );
}
