import type { Metadata, Viewport } from 'next';
import DesignRuntime from './_components/design-runtime';
import SiteFooterMarkup from './_design/footer-markup';
import SiteHeaderMarkup from './_design/header-markup';
import './marketing.css';

export const metadata: Metadata = {
  title: {
    default: 'Alisio PMS — property management for hotels, glampings and apartments',
    template: '%s — Alisio PMS',
  },
  description:
    'A full property management system with a digital crew on top: pricing, guest replies, housekeeping, payments and compliance. Connect it read-only for 14 days and see what it would have earned.',
};

/**
 * The dashboard locks zoom for its app-like shell. A public site must not —
 * pinch-zoom is the reason the marketing group declares its own viewport.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#08090B',
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dcx-root">
      <noscript>
        {/* Reveal animations start hidden; without script nothing would ever show them. */}
        <style>{'[data-reveal]{opacity:1 !important;transform:none !important}'}</style>
      </noscript>
      <div className="dcx-aura" aria-hidden="true" />
      <SiteHeaderMarkup />
      <main style={{ position: 'relative', zIndex: 1, paddingTop: '70px' }}>{children}</main>
      <SiteFooterMarkup />
      <DesignRuntime />
    </div>
  );
}
