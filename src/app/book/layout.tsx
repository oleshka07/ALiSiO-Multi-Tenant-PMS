import type { Metadata, Viewport } from 'next';
import './booking-wizard.css';

export const metadata: Metadata = {
  title: 'Book — Kemp Carlsbad',
  description: 'Book your stay at Kemp Carlsbad — glamping, resort, camping near Karlovy Vary',
  manifest: '/book-manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Kemp Book',
  },
  icons: {
    apple: '/icons/kemp-apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#2E6B4F',
};

export default function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
