import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // argon2 yerel (native) modül; paketlenmeden Node'dan yüklenir.
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  poweredByHeader: false,
};

export default nextConfig;
