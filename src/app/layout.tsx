import type { Metadata, Viewport } from 'next';
import './globals.css';
import { THEME_BOOT_SCRIPT } from '@/ui/theme';

export const metadata: Metadata = {
  title: 'ALiSiO ERP — Hotel Business Management',
  description: 'Modern property management system for glamping, resort, and camping properties',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ALiSiO ERP',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // Світла тема за замовчуванням (П18); темну ставить атрибут data-theme.
  themeColor: '#f4f5f9',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <head>
        {/* Тема до першого малювання: кука → localStorage → світла. Див. src/ui/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      <link rel="apple-touch-startup-image" href="/icons/icon-512.svg" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
