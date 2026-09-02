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
  async rewrites() {
    return [
      {
        // One embed script, two URLs.
        //
        // `public/embed.v2.js` and `public/widget/embed.v2.js` were two real
        // files, and they had drifted: the root one grew the Meta/GA4/TikTok
        // listeners, the one the interface hands out grew language, redirect
        // and query forwarding. Neither was a superset, so whichever a hotel
        // had, something silently did not work.
        //
        // Now there is one file. This keeps the older URL alive for pages that
        // already reference it — we do not get to edit a hotel's website, so a
        // path we once published has to keep answering.
        source: '/embed.v2.js',
        destination: '/widget/embed.v2.js',
      },
    ];
  },
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
        // The one screen that embeds a foreign origin: the channel manager's
        // mapping window, opened with a one-time token minted on the server.
        // Named explicitly rather than left to the browser default, and only
        // these two hosts — a page that could frame anything is a page that
        // could frame a phishing copy of the vendor's login.
        source: "/app/settings/channel-manager/connect",
        headers: [
          ...securityHeaders,
          { key: "Content-Security-Policy", value: "frame-src https://staging.channex.io https://app.channex.io" },
        ],
      },
      {
        source: "/((?!w/|guest/|app/settings/channel-manager/connect).*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
