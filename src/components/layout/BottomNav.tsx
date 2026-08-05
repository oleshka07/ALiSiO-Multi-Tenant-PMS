'use client';

import { useT } from '@core/i18n/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  Users,
  MoreHorizontal,
} from 'lucide-react';

interface BottomNavProps {
  onMoreClick?: () => void;
}

const tabs = [
  { label: 'Dashboard', href: '/app/dashboard', icon: LayoutDashboard },
  { label: 'Календар', href: '/app/calendar', icon: CalendarDays },
  { label: 'Бронювання', href: '/app/bookings', icon: BookOpen },
  { label: 'Гості', href: '/app/guests', icon: Users },
];

export default function BottomNav({ onMoreClick }: BottomNavProps) {
  const t = useT();
  const pathname = usePathname();

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
        <button
          className={`bottom-nav-item`}
          onClick={onMoreClick}
        >
          <MoreHorizontal size={20} />
          <span>{t('Більше')}</span>
        </button>
      </div>
    </nav>
  );
}
