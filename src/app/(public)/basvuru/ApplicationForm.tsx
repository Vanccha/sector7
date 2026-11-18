"use client";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import styles from "../public.module.css";
import { githubUsernameSchema } from "@/lib/contracts/github";
import { submitApplicationAction } from "./actions";

export function ApplicationForm() {
  const [pending, startTransition] = useTransition();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    setError(null);
    setFields({});
    const gh = githubUsernameSchema.safeParse(get("githubUsername"));
    if (!gh.success) {
      setFields({ githubUsername: gh.error.issues[0]?.message ?? "Geçerli bir GitHub kullanıcı adı yaz." });
      setError("Bazı alanları gözden geçirir misin?");
      return;
    }
    startTransition(async () => {
      const res = await submitApplicationAction({
        fullName: get("fullName"),
        username: get("username"),
        email: get("email"),
        phone: get("phone"),
        intro: get("intro"),
        githubUsername: get("githubUsername"),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const f = res.fields ?? {};
        setFields(f);
        setError(Object.keys(f).length ? "Bazı alanları gözden geçirir misin?" : res.error);
      }
    });
  }

  if (done) {
    return (
      <section className={`cut-panel cut-panel--raised ${styles.card}`} aria-labelledby="tesekkur-h">
        <h1 id="tesekkur-h" className="h-wide">
          Teşekkürler
        </h1>
        <p className="notice notice--ok" role="status">
          Başvurun ana yöneticilere iletildi. Onaylanırsa sana bir şifre belirleme bağlantısı ulaştırılacak.
        </p>
        <Link href="/giris" className="btn-line btn-block">
          Giriş sayfasına dön
        </Link>
      </section>
    );
  }

  const attrs = (name: string, hint: boolean) => ({
    id: name,
    name,
    "aria-invalid": fields[name] ? true : undefined,
    "aria-describedby": [hint ? `${name}-hint` : "", fields[name] ? `${name}-err` : ""].filter(Boolean).join(" ") || undefined,
  });
  const err = (name: string) =>
    fields[name] ? (
      <p id={`${name}-err`} className="field-error">
        {fields[name]}
      </p>
    ) : null;

  return (
    <section className={`cut-panel cut-panel--raised ${styles.card}`} aria-labelledby="basvuru-h">
      <h1 id="basvuru-h" className="h-wide">
        Başvuru
      </h1>
      <form onSubmit={onSubmit} noValidate className={styles.form}>
        <div className="field">
          <label className="label" htmlFor="fullName">
            Ad soyad
          </label>
          <input {...attrs("fullName", false)} className="input" type="text" autoComplete="name" required />
          {err("fullName")}
        </div>
        <div className="field">
          <label className="label" htmlFor="username">
            Kullanıcı adı
          </label>
          <input
            {...attrs("username", true)}
            className="input"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <p id="username-hint" className="hint">
            3-30 karakter; küçük harf, rakam, _ ve . kullanılabilir.
          </p>
          {err("username")}
        </div>
        <div className="field">
          <label className="label" htmlFor="email">
            E-posta
          </label>
          <input {...attrs("email", true)} className="input" type="email" autoComplete="email" required />
          <p id="email-hint" className="hint">
            E-postanı yalnız ana yöneticiler görür.
          </p>
          {err("email")}
        </div>
        <div className="field">
          <label className="label" htmlFor="phone">
            Telefon
          </label>
          <input {...attrs("phone", true)} className="input" type="tel" autoComplete="tel" required />
          <p id="phone-hint" className="hint">
            Telefonunu yalnız ana yöneticiler görür.
          </p>
          {err("phone")}
        </div>
        <div className="field">
          <label className="label" htmlFor="intro">
            Kısa tanıtım ve ilgi alanların
          </label>
          <textarea {...attrs("intro", true)} className="textarea" rows={5} required />
          <p id="intro-hint" className="hint">
            En az 20 karakter.
          </p>
          {err("intro")}
        </div>
        <div className="field">
          <label className="label" htmlFor="githubUsername">
            GitHub kullanıcı adı (isteğe bağlı)
          </label>
          <input
            {...attrs("githubUsername", true)}
            className="input"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="@kullanici"
          />
          <p id="githubUsername-hint" className="hint">
            Varsa yaz; ticket almadan önce hesabını bağlaman istenecek.
          </p>
          {err("githubUsername")}
        </div>
        <div aria-live="polite">
          {error && (
            <p className="notice notice--hot" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="btn-solid btn-block" disabled={pending}>
          {pending ? "Gönderiliyor…" : "Başvuruyu gönder"}
        </button>
      </form>
      <p>
        Zaten hesabın var mı?{" "}
        <Link href="/giris" className={styles.link}>
          Giriş yap
        </Link>
      </p>
    </section>
  );
}
