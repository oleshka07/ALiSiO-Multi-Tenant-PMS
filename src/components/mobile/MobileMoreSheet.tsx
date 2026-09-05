'use client';

/**
 * Аркуш «Більше» на телефоні: усе з верхнього меню, чого немає в нижній
 * панелі (П12). Список той самий, що в `TopNav` (`nav-items.ts`), із тими
 * самими фільтрами — права, ключі модулів, країна; другого списку немає, щоб
 * пункт не зʼявлявся в одному місці й не зникав в іншому.
 */
import { useT } from '@core/i18n/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X, LogOut } from 'lucide-react';
import { hasPermission } from '@core/auth/permissions';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { TOP_NAV, visibleNavItems, type NavItem } from '@/components/layout/nav-items';

interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Плоский список: пункт із підпунктами розгортається у свої підпункти. */
function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((i) => (i.children ? i.children : [i]));
}

export default function MobileMoreSheet({ open, onClose }: MobileMoreSheetProps) {
  const t = useT();
  const pathname = usePathname();
  const { user, features, organization, logout } = useCurrentUser();

  useBodyScrollLock(open);

  if (!open) return null;

  const visible = user
    ? visibleNavItems(TOP_NAV, { permissions: user.permissions, features, countries: organization?.countries }, hasPermission)
    : [];
  // У нижній панелі вже є чотири основні (без підпунктів); тут — решта.
  const primaryHrefs = new Set(visible.filter((p) => p.primary).map((p) => p.href));
  const items = flatten(visible.filter((i) => !i.primary || i.children)).filter((i) => !primaryHrefs.has(i.href));

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose} />
      <div className="m-sheet">
        <div className="m-sheet-handle" />
        <div className="m-sheet-header">
          <h2>{t('Більше')}</h2>
          <button className="m-header-btn" onClick={onClose} aria-label={t('Закрити')}><X size={20} /></button>
        </div>

        {/* User info */}
        {user && (
          <div className="m-sheet-user">
            <div className="m-sheet-avatar">{user.full_name?.[0]?.toUpperCase() || '?'}</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{user.full_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{user.role}</div>
            </div>
          </div>
        )}

        <div className="m-sheet-sections">
          <div className="m-sheet-section">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`m-sheet-item ${isActive ? 'm-sheet-item-active' : ''}`}
                  onClick={onClose}
                >
                  <Icon size={20} />
                  <span>{t(item.label)}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <button className="m-sheet-logout" onClick={logout}>
          <LogOut size={18} />
          <span>{t('Вийти')}</span>
        </button>
      </div>
    </>
  );
}
