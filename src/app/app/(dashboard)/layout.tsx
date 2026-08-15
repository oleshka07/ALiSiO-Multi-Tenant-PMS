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
  const router = useRouter();
  const { isMobile } = useDevice();

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const me = await res.json().catch(() => null);
          if (me?.language) setLanguage(parseLanguage(me.language));
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

  // ─── Mobile Layout ──────────────────────────────
  if (isMobile) {
    return (
      <I18nProvider language={language}>
        <MobileMenuContext.Provider value={() => setMobileMenuOpen(true)}>
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
