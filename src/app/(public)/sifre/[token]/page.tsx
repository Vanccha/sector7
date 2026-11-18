import Link from "next/link";
import { db } from "@/db";
import { inspectPasswordToken } from "@/server/accounts";
import styles from "../../public.module.css";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Şifre" };

export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await inspectPasswordToken(db, token);

  if (!info) {
    return (
      <section className={`cut-panel cut-panel--raised ${styles.card}`} aria-labelledby="gecersiz-h">
        <h1 id="gecersiz-h" className="h-wide">
          Bağlantı kullanılamıyor
        </h1>
        <p>Bu bağlantı geçersiz ya da süresi dolmuş. Bir ana yöneticiden yeni bağlantı isteyebilirsin.</p>
        <Link href="/giris" className="btn-line btn-block">
          Giriş sayfasına git
        </Link>
      </section>
    );
  }

  return (
    <SetPasswordForm
      token={token}
      name={info.name}
      username={info.username}
      title={info.purpose === "setup" ? "Şifreni belirle" : "Yeni şifre belirle"}
    />
  );
}
