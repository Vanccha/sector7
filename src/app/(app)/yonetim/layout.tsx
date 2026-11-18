import { Suspense } from "react";
import { NavLinks } from "@/components/shell/NavLinks";
import { requirePageMainAdmin } from "@/lib/auth/session";

const TABS = [
  { href: "/yonetim/basvurular", label: "Başvurular" },
  { href: "/yonetim/alanlar", label: "Alanlar" },
  { href: "/yonetim/sprintler", label: "Sprintler" },
  { href: "/yonetim/talepler", label: "Talepler" },
  { href: "/yonetim/roadmapler", label: "Roadmap onayları" },
  { href: "/yonetim/duyuru-yetkisi", label: "Duyuru yetkisi" },
];

/** Ana yönetici bölümü: alt sekmeler. Yetki her sayfada ve her action'da ayrıca kontrol edilir. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageMainAdmin();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Suspense>
        <NavLinks items={TABS} label="Yönetim bölümleri" />
      </Suspense>
      {children}
    </div>
  );
}
