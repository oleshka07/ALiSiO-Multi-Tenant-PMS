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

interface BottomNavProps {
  onMoreClick?: () => void;
}

const tabs = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Календар', href: '/calendar', icon: CalendarDays },
  { label: 'Бронювання', href: '/bookings', icon: BookOpen },
  { label: 'Гості', href: '/guests', icon: Users },
];

export default function BottomNav({ onMoreClick }: BottomNavProps) {
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
              <span>{tab.label}</span>
            </Link>
          );
        })}
        <button
          className={`bottom-nav-item`}
          onClick={onMoreClick}
        >
          <MoreHorizontal size={20} />
          <span>Більше</span>
        </button>
      </div>
    </nav>
  );
}
