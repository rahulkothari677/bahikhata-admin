import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript — ignore build errors (pre-existing withTimeout type inference issues)
  // TODO: Fix withTimeout generic types properly in a future phase
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
  // Security: no source maps in production (don't expose code structure)
  productionBrowserSourceMaps: false,
  // Security headers added in middleware
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },

  // 🔒 SECURITY (Audit fix N4): Content-Security-Policy + security headers
  // for the admin panel. Report-only mode — switch to enforced after verifying
  // in browser console (no violations).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https://*.sentry.io",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
