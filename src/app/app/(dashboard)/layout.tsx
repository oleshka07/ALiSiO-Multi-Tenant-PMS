'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import BottomNav from '@/components/layout/BottomNav';
import MobileLayout from '@/components/mobile/MobileLayout';
import { MobileMenuContext } from '@/ui/MobileMenuContext';
import { useDevice } from '@/ui/hooks/useDevice';
import { I18nProvider, useT } from '@core/i18n/client';
import { DEFAULT_LANGUAGE, type Language, parseLanguage } from '@core/i18n/languages';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useT();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Comes back on the same /api/auth/me the auth check already makes — one
  // request decides both whether this person may be here and what they read.
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  // Set only when the supplier is working inside a customer's account. The
  // screens are the customer's own, so the only thing that must never be in
  // doubt is whose data is on them.
  const [platformEmail, setPlatformEmail] = useState<string | null>(null);
  const router = useRouter();
  const { isMobile } = useDevice();

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const me = await res.json().catch(() => null);
          if (me?.language) setLanguage(parseLanguage(me.language));
          setPlatformEmail(me?.platform?.email ?? null);
          setAuthorized(true);
        } else {
          router.replace('/app/login');
        }
      } catch {
        router.replace('/app/login');
      } finally {
        setChecking(false);
      }
    }
    checkAuth();
  }, [router]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        color: 'var(--text-tertiary)',
        fontSize: 14,
      }}>
        {t('Завантаження...')}
      </div>
    );
  }

  if (!authorized) return null;


  /**
   * A bar that cannot be dismissed, on every screen, for as long as the
   * supplier is inside somebody else's hotel. The screens look exactly like
   * the customer's own — which is the point, and also the danger: work meant
   * for one hotel done in another is the mistake this makes impossible to
   * commit absent-mindedly.
   */
  const supportBanner = platformEmail ? (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      background: '#7c2d12', color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 600,
    }}>
      <span>Режим підтримки — ви в акаунті клієнта ({platformEmail}). Кожна дія підписана вашим імʼям.</span>
      <button
        onClick={async () => {
          await fetch('/api/platform/leave', { method: 'POST' });
          window.location.href = '/app/platform';
        }}
        style={{
          background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        Вийти з акаунта
      </button>
    </div>
  ) : null;

  // ─── Mobile Layout ──────────────────────────────
  if (isMobile) {
    return (
      <I18nProvider language={language}>
        <MobileMenuContext.Provider value={() => setMobileMenuOpen(true)}>
          {supportBanner}
          <MobileLayout>
            {children}
          </MobileLayout>
        </MobileMenuContext.Provider>
      </I18nProvider>
    );
  }

  // ─── Desktop Layout ─────────────────────────────
  return (
    <I18nProvider language={language}>
    <div className="app-layout">
      {supportBanner && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000 }}>{supportBanner}</div>
      )}
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />
      <main className="app-main">
        <MobileMenuContext.Provider value={() => setMobileMenuOpen(true)}>
          {children}
        </MobileMenuContext.Provider>
      </main>
      <BottomNav onMoreClick={() => setMobileMenuOpen(true)} />
    </div>
    </I18nProvider>
  );
}
