import { renderIcon } from "@/components/pwa/iconArt";

export const dynamic = "force-static";

const VARIANTS: Record<string, () => Response> = {
  "192.png": () => renderIcon(192, { safe: 0.62, frame: true }),
  "512.png": () => renderIcon(512, { safe: 0.62, frame: true }),
  // Maskable: işaret orta güvenli alanda kalsın, çerçeve yok.
  "maskable-512.png": () => renderIcon(512, { safe: 0.5 }),
};

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((name) => ({ name }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const make = VARIANTS[name];
  if (!make) return new Response("Bulunamadı", { status: 404 });
  return make();
}
