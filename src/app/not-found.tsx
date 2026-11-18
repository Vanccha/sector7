import Link from "next/link";
import { Brand } from "@/components/shell/Brand";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "var(--gutter)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        textAlign: "center",
      }}
    >
      <Brand />
      <h1 className="h-wide">Aradığın sayfa yok</h1>
      <p className="muted">Bağlantı değişmiş ya da sayfa kaldırılmış olabilir.</p>
      <Link href="/" className="btn-solid">
        Ana sayfaya dön
      </Link>
    </main>
  );
}
