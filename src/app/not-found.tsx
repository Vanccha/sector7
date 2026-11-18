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
      }}
    >
      <Brand />
      <section className="cut-panel cut-panel--raised" style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
          Aradığın sayfa yok
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          Bağlantı değişmiş ya da sayfa kaldırılmış olabilir.
        </p>
        <Link href="/" className="btn-solid">
          Ana sayfaya dön
        </Link>
      </section>
    </main>
  );
}
