'use client';

/**
 * Кнопка акаунта — те, що коригують час від часу.
 *
 * Кнопка з людиною стояла в шапці всіх 77 екранів і не робила нічого. Меню
 * під нею — не копія «Налаштувань»: там 14 екранів, і більшість із них
 * налаштовують один раз під час запуску. Тут лише те, до чого повертаються:
 * хто я, який готель, яка валюта, хто ще має доступ, і вихід.
 *
 * ── Чому пункти фільтруються ────────────────────────────────────────────
 *
 * `manage_users` є не в кожного. Показати оператору «Користувачі та ролі» й
 * дати 403 після натискання — гірше за відсутній пункт: людина двічі
 * перевірить, чи не зламалось. Список береться з того самого каталогу
 * `core/navigation.ts`, що й пошук, тож новий екран не треба додавати двічі.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useT } from '@core/i18n/client';
import { User, LogOut, ChevronRight } from 'lucide-react';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { hasPermission, ROLE_LABELS } from '@core/auth/permissions';
import { DESTINATIONS } from '@core/navigation';
import ThemeToggle from './ThemeToggle';

/**
 * Що саме коригують періодично.
 *
 * Адреси, а не назви: назва береться з каталогу, щоб перейменування екрана не
 * лишило тут старого підпису. Адреса, якої в каталозі немає, просто не
 * покажеться — і це помітно на очі, на відміну від мертвого посилання.
 */
const ACCOUNT_LINKS = [
  '/app/settings/general',
  '/app/settings/users',
  '/app/settings/features',
  '/app/settings/invoicing',
];

export default function AccountMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { user, features, organization, logout } = useCurrentUser();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items = ACCOUNT_LINKS
    .map((href) => DESTINATIONS.find((d) => d.href === href))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .filter((d) => !user || hasPermission(user.permissions, d.permission))
    .filter((d) => !d.feature || features[d.feature]);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost btn-icon"
        aria-label={t('Акаунт')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <User size={18} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 500,
            minWidth: 260, background: 'var(--bg-card)', borderRadius: 10,
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-primary)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {user?.full_name || user?.email || '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {user ? t(ROLE_LABELS[user.role] ?? user.role) : ''}
              {/* Валюта тут навмисно: вона діє на весь застосунок, і побачити
                  її треба раніше, ніж людина здивується сумі у звіті. */}
              {organization?.currency ? ` · ${organization.currency}` : ''}
            </div>
          </div>

          <div style={{ padding: '4px 0' }}>
            {items.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 10, padding: '9px 14px', fontSize: 14,
                  color: 'var(--text-primary)', textDecoration: 'none',
                }}
              >
                <span>{t(d.label)}</span>
                <ChevronRight size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              </Link>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border-primary)', padding: '4px 0' }}>
            {/* Тема (П18): світла за замовчуванням, темна — тут. */}
            <ThemeToggle />
          </div>

          <div style={{ borderTop: '1px solid var(--border-primary)', padding: '4px 0' }}>
            <button
              onClick={() => { setOpen(false); logout(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 14px', fontSize: 14, border: 'none', background: 'transparent',
                cursor: 'pointer', color: 'var(--accent-danger)', textAlign: 'left',
              }}
            >
              <LogOut size={15} />
              {t('Вийти')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
