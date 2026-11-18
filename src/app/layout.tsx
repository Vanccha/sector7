import type { Metadata, Viewport } from "next";
import { Saira } from "next/font/google";
import { db } from "@/db";
import { getActiveSprintView } from "@/lib/current-sprint";
import "@/styles/globals.css";

const saira = Saira({
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  variable: "--font-saira",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "AllSpark", template: "%s · AllSpark" },
  description: "AllSpark topluluğunun çalışma sistemi.",
  applicationName: "AllSpark",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070915",
};

// Tema veritabanındaki aktif sprintten hesaplandığı için her istekte yeniden üretilir.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sprint = await getActiveSprintView(db).catch(() => null);
  return (
    <html lang="tr" data-theme={sprint?.theme ?? "blue"} className={saira.variable}>
      <body>{children}</body>
    </html>
  );
}
