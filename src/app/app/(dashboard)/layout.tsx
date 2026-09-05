'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopNav from '@/components/layout/TopNav';
import BottomNav from '@/components/layout/BottomNav';
import MobileMoreSheet from '@/components/mobile/MobileMoreSheet';
import MobileLayout from '@/components/mobile/MobileLayout';
import { MobileMenuContext } from '@/ui/MobileMenuContext';
import { GlobalSearchContext } from '@/ui/GlobalSearchContext';
import GlobalSearch from '@/components/layout/GlobalSearch';
import ModuleGate from '@/components/layout/ModuleGate';
import { useDevice } from '@/ui/hooks/useDevice';
import { I18nProvider, useT } from '@core/i18n/client';
import { PropertyScopeProvider, type ScopedProperty } from '@/ui/PropertyScopeContext';
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
  const [searchOpen, setSearchOpen] = useState(false);
  // Comes back on the same /api/auth/me the auth check already makes — one
  // request decides both whether this person may be here and what they read.
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  // Set only when the supplier is working inside a customer's account. The
  // screens are the customer's own, so the only thing that must never be in
  // doubt is whose data is on them.
  const [platformEmail, setPlatformEmail] = useState<string | null>(null);
  // Обʼєкти організації і запамʼятований вибір — з тієї самої відповіді.
  // Область обʼєкта живе в провайдері нижче, один на всю оболонку
  // (src/ui/PropertyScopeContext.tsx), а не в кожному екрані окремо.
  const [scope, setScope] = useState<{ properties: ScopedProperty[]; remembered: string | null }>({ properties: [], remembered: null });
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
          setScope({
            properties: Array.isArray(me?.properties) ? me.properties : [],
            remembered: typeof me?.property === 'string' ? me.property : null,
          });
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

  // Ctrl+K / ⌘K — з будь-якого екрана. Слухач один, у розкладці: у `Header`
  // він був би на кожному з 77 екранів.
  //
  // Поле вводу пропускається навмисно: людина, яка друкує в полі «Ім'я гостя»,
  // натискає Ctrl+K, щоб стерти рядок (звичка з терміналу), а не щоб відкрити
  // пошук. Але коли сам пошук уже відкритий, він і є полем — і має право.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'k' && e.key !== 'K' && e.key !== 'л' && e.key !== 'Л') return;
      if (!e.metaKey && !e.ctrlKey) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing && !searchOpen) return;
      e.preventDefault();
      setSearchOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

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
      <span>{t('Режим підтримки — ви в акаунті клієнта. Кожна дія підписана вашим імʼям.')} ({platformEmail})</span>
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
        {t('Вийти з акаунта')}
      </button>
    </div>
  ) : null;

  // ─── Mobile Layout ──────────────────────────────
  if (isMobile) {
    return (
      <I18nProvider language={language}>
        <PropertyScopeProvider properties={scope.properties} remembered={scope.remembered}>
        <MobileMenuContext.Provider value={() => setMobileMenuOpen(true)}>
          <GlobalSearchContext.Provider value={() => setSearchOpen(true)}>
            {supportBanner}
            <MobileLayout>
              <ModuleGate>{children}</ModuleGate>
            </MobileLayout>
            <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
          </GlobalSearchContext.Provider>
        </MobileMenuContext.Provider>
        </PropertyScopeProvider>
      </I18nProvider>
    );
  }

  // ─── Desktop Layout ─────────────────────────────
  return (
    <I18nProvider language={language}>
    <PropertyScopeProvider properties={scope.properties} remembered={scope.remembered}>
    <div className="app-layout">
      {supportBanner && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000 }}>{supportBanner}</div>
      )}
      {/* Верхнє меню замість бічної панелі (П12). На вузькому вікні пункти
          ховає CSS, а кнопка меню в шапці екрана відкриває аркуш «Більше». */}
      <TopNav />
      <main className="app-main">
        <MobileMenuContext.Provider value={() => setMobileMenuOpen(true)}>
          <GlobalSearchContext.Provider value={() => setSearchOpen(true)}>
            <ModuleGate>{children}</ModuleGate>
          </GlobalSearchContext.Provider>
        </MobileMenuContext.Provider>
      </main>
      <BottomNav onMoreClick={() => setMobileMenuOpen(true)} />
      <MobileMoreSheet open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
    </PropertyScopeProvider>
    </I18nProvider>
  );
}
