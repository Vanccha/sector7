"use client";
import { useState } from "react";
import { LoginForm } from "./LoginForm";
import { RememberedLogin, type RememberedAccount } from "./RememberedLogin";

/** Hatırlanan hesap varsa tek tıkla giriş görünümü, yoksa (ya da "Başka bir hesapla") normal form. */
export function LoginGate({ remembered }: { remembered: RememberedAccount | null }) {
  const [account, setAccount] = useState(remembered);
  const [notice, setNotice] = useState<string | null>(null);
  if (account) {
    return (
      <RememberedLogin
        account={account}
        onUseForm={(message) => {
          setNotice(message ?? null);
          setAccount(null);
        }}
      />
    );
  }
  return <LoginForm notice={notice} />;
}
