import { renderIcon } from "@/components/pwa/iconArt";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderIcon(180, { safe: 0.66 });
}
