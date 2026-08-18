import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Self-contained build output for the Hetzner Docker deploy.
  output: 'standalone',
  // Exclude native Node.js modules from client-side bundling.
  // NOTE: pdfjs-dist is intentionally NOT listed here — it is an ESM module
  // that cannot be externalized by Turbopack (Next.js 16 default bundler).
  // Listing it causes "client reference manifest does not exist" build failures.
  serverExternalPackages: ['better-sqlite3', 'imapflow', 'nodemailer', 'pdfkit', 'pdf-parse'],
  // Fix Turbopack workspace root detection on VPS. Must be absolute — a relative
  // path is ignored with a warning and root detection falls back to guessing.
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [
      {
        source: "/w/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
      {
        // The guest page may be framed by OUR OWN origin only: the settings
        // screen shows it live in a phone frame while the hotel toggles
        // sections. 'self', not '*' — a stranger's site still cannot wrap the
        // page for clickjacking.
        source: "/guest/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          ...securityHeaders.filter((h) => h.key !== 'X-Frame-Options'),
        ],
      },
      {
        source: "/((?!w/|guest/).*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
