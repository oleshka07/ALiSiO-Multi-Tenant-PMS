'use client';

/**
 * Нижня панель на вузькому вікні: чотири основні пункти верхнього меню
 * (`primary` у `nav-items.ts` — Dashboard, Планер, Бронювання, Гості, як у
 * MASTER-PLAN §1.1) і «Більше», що відкриває аркуш із решти.
 */
import { useT } from '@core/i18n/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { hasPermission } from '@core/auth/permissions';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { TOP_NAV, visibleNavItems } from './nav-items';

interface BottomNavProps {
  onMoreClick?: () => void;
}

export default function BottomNav({ onMoreClick }: BottomNavProps) {
  const t = useT();
  const pathname = usePathname();
  const { user, features, organization } = useCurrentUser();
  const tabs = (user
    ? visibleNavItems(TOP_NAV, { permissions: user.permissions, features, countries: organization?.countries }, hasPermission)
    : TOP_NAV).filter((i) => i.primary);

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-items">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`bottom-nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={20} />
              <span>{t(tab.label)}</span>
            </Link>
          );
        })}
        <button className="bottom-nav-item" onClick={onMoreClick}>
          <MoreHorizontal size={20} />
          <span>{t('Більше')}</span>
        </button>
      </div>
    </nav>
  );
}
