import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // argon2 yerel (native) modül; paketlenmeden Node'dan yüklenir.
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  poweredByHeader: false,
  // Geliştirme sunucusundaki sol alttaki Next.js "N" göstergesini gizler.
  devIndicators: false,
};

export default nextConfig;
