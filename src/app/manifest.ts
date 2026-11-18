import type { MetadataRoute } from "next";

const icon192 = [{ src: "/pwa-icons/192.png", sizes: "192x192", type: "image/png" }];

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AllSpark",
    short_name: "AllSpark",
    description: "AllSpark topluluğunun çalışma sistemi: sprint, ticket ve iletişim tek yerde.",
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#070915",
    theme_color: "#070915",
    categories: ["productivity", "business"],
    icons: [
      { src: "/pwa-icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Kıvılcım çak", url: "/", icons: icon192 },
      { name: "Ticket'larım", url: "/ticketlarim", icons: icon192 },
      { name: "Mesajlar", url: "/mesajlar", icons: icon192 },
    ],
  };
}
