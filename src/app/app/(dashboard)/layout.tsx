'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import BottomNav from '@/components/layout/BottomNav';
import MobileLayout from '@/components/mobile/MobileLayout';
import { MobileMenuContext } from '@/lib/MobileMenuContext';
import ChatWidget from '@/components/ai/ChatWidget';
import { useDevice } from '@/lib/useDevice';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();
  const { isMobile } = useDevice();

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
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
        Завантаження...
      </div>
    );
  }

  if (!authorized) return null;

  // ─── Mobile Layout ──────────────────────────────
  if (isMobile) {
    return (
      <MobileMenuContext.Provider value={() => setMobileMenuOpen(true)}>
        <MobileLayout>
          {children}
        </MobileLayout>
      </MobileMenuContext.Provider>
    );
  }

  // ─── Desktop Layout ─────────────────────────────
  return (
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
      <ChatWidget />
    </div>
  );
}
