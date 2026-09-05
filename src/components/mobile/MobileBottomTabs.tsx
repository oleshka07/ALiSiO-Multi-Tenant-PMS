'use client';

import { useT } from '@core/i18n/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { hasPermission } from '@core/auth/permissions';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { TOP_NAV, visibleNavItems } from '@/components/layout/nav-items';

interface MobileBottomTabsProps {
  onMoreClick?: () => void;
}

// Ті самі чотири основні пункти, що й у верхньому меню (`primary` у
// nav-items.ts), і «Більше» — один список, одні фільтри.
export default function MobileBottomTabs({ onMoreClick }: MobileBottomTabsProps) {
  const t = useT();
  const pathname = usePathname();
  const { user, features, organization } = useCurrentUser();
  const tabs = [
    ...(user
      ? visibleNavItems(TOP_NAV, { permissions: user.permissions, features, countries: organization?.countries }, hasPermission)
      : TOP_NAV).filter((i) => i.primary).map((i) => ({ label: i.label, href: i.href, icon: i.icon })),
    { label: 'Більше', href: '__more__', icon: MoreHorizontal },
  ];

  return (
    <nav className="m-bottom-tabs">
      {tabs.map((tab) => {
        if (tab.href === '__more__') {
          return (
            <button
              key="more"
              className="m-tab-item"
              onClick={onMoreClick}
            >
              <tab.icon size={22} />
              <span>{t(tab.label)}</span>
            </button>
          );
        }

        const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/');
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`m-tab-item ${isActive ? 'm-tab-active' : ''}`}
          >
            <tab.icon size={22} />
            <span>{t(tab.label)}</span>
            {isActive && <div className="m-tab-pill" />}
          </Link>
        );
      })}
    </nav>
  );
}
