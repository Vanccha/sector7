import { renderIcon } from "@/components/pwa/iconArt";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return renderIcon(64, { safe: 0.78 });
}
