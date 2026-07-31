'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  Users,
  MoreHorizontal,
} from 'lucide-react';

interface MobileBottomTabsProps {
  onMoreClick?: () => void;
}

const tabs = [
  { label: 'Головна',    href: '/app/dashboard', icon: LayoutDashboard },
  { label: 'Бронювання', href: '/app/bookings',  icon: BookOpen },
  { label: 'Календар',   href: '/app/calendar',  icon: CalendarDays },
  { label: 'Гості',      href: '/app/guests',    icon: Users },
  { label: 'Більше',     href: '__more__',   icon: MoreHorizontal },
];

export default function MobileBottomTabs({ onMoreClick }: MobileBottomTabsProps) {
  const pathname = usePathname();

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
              <span>{tab.label}</span>
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
            <span>{tab.label}</span>
            {isActive && <div className="m-tab-pill" />}
          </Link>
        );
      })}
    </nav>
  );
}
