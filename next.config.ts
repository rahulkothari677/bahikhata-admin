import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strict TypeScript — build FAILS on type errors (no ignoreBuildErrors)
  reactStrictMode: true,
  // Security: no source maps in production (don't expose code structure)
  productionBrowserSourceMaps: false,
  // Security headers added in middleware
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
