import type { Metadata, Viewport } from "next";
import { Saira } from "next/font/google";
import { getRequestSprint } from "@/lib/current-sprint-request";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { HangarIntro } from "@/components/shell/HangarIntro";
import { HANGAR_INTRO_INIT } from "@/components/shell/hangar-intro-init";
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
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AllSpark", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

const THEME_BG = { blue: "#070915", amber: "#111214", red: "#111214" } as const;

export async function generateViewport(): Promise<Viewport> {
  const sprint = await getRequestSprint();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: THEME_BG[sprint?.theme ?? "blue"],
  };
}

// Tema veritabanındaki aktif sprintten hesaplandığı için her istekte yeniden üretilir.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sprint = await getRequestSprint();
  return (
    // suppressHydrationWarning: HANGAR_INTRO_INIT, <html data-intro> / class değerlerini boyamadan önce yazar.
    <html lang="tr" data-theme={sprint?.theme ?? "blue"} className={saira.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HANGAR_INTRO_INIT }} />
      </head>
      <body>
        {children}
        <HangarIntro />
        <ServiceWorkerRegistrar />
        <InstallPrompt />
      </body>
    </html>
  );
}
