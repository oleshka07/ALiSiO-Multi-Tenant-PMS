'use client';

import { usePathname } from 'next/navigation';
import { ArrowLeft, Bell, Search } from 'lucide-react';

interface MobileHeaderProps {
  title?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  showSearch?: boolean;
  onSearch?: () => void;
}

const ROUTE_TITLES: Record<string, string> = {
  '/app/dashboard': 'Dashboard',
  '/app/calendar': 'Календар',
  '/app/bookings': 'Бронювання',
  '/app/guests': 'Гості',
  '/app/finance': 'Фінанси',
  '/app/settings': 'Налаштування',
  '/app/pricing': 'Ціноутворення',
  '/app/reports': 'Звіти',
};

export default function MobileHeader({ title, onBack, rightAction, showSearch, onSearch }: MobileHeaderProps) {
  const pathname = usePathname();
  const pageTitle = title || ROUTE_TITLES[pathname] || 'ALiSiO';

  return (
    <header className="m-header">
      <div className="m-header-left">
        {onBack ? (
          <button className="m-header-btn" onClick={onBack} aria-label="Назад">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <span className="m-header-logo">A</span>
        )}
      </div>
      <h1 className="m-header-title">{pageTitle}</h1>
      <div className="m-header-right">
        {showSearch && (
          <button className="m-header-btn" onClick={onSearch} aria-label="Пошук">
            <Search size={20} />
          </button>
        )}
        {rightAction}
        <button className="m-header-btn m-header-bell" aria-label="Сповіщення">
          <Bell size={20} />
        </button>
      </div>
    </header>
  );
}
