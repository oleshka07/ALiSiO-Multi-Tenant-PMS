'use client';

import {
  BarChart3,
  BookOpen,
  Building,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Settings,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const navigation = [
    {
      title: 'Основне',
      items: [
        { label: "Об'єкти (Properties)", href: '/', icon: <Building size={20} /> },
        { label: 'Календар (Шахматка)', href: '/calendar', icon: <CalendarDays size={20} /> },
        { label: 'Бронювання', href: '/bookings', icon: <BookOpen size={20} /> },
      ],
    },
    {
      title: 'Управління',
      items: [
        { label: 'Ціноутворення', href: '/pricing', icon: <DollarSign size={20} /> },
        { label: 'Звіти та Аналітика', href: '/reports', icon: <BarChart3 size={20} /> },
        { label: 'Гості', href: '/guests', icon: <Users size={20} /> },
      ],
    },
    {
      title: 'Система',
      items: [{ label: 'Налаштування', href: '/settings', icon: <Settings size={20} /> }],
    },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label="Close mobile sidebar backdrop"
        className={`sidebar-backdrop ${mobileOpen ? 'visible' : ''}`}
        onClick={onMobileClose}
      />

      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      >
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">A</div>
          <span className="sidebar-logo-text">ALiSiO PMS</span>
          {mobileOpen && (
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={onMobileClose}
              style={{ marginLeft: 'auto', display: 'flex' }}
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navigation.map((section) => (
            <div key={section.title}>
              <div className="sidebar-section-title">{section.title}</div>
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                  >
                    <span className="sidebar-nav-icon">{item.icon}</span>
                    <span className="sidebar-nav-label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User Info */}
        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <div className="sidebar-user-avatar" style={{ background: '#4f6ef7' }}>
              US
            </div>
            <div className="sidebar-user-details">
              <div className="sidebar-user-name">Адміністратор</div>
              <div className="sidebar-user-role">Multi-Tenant Admin</div>
            </div>
          </div>
        </div>

        {/* Toggle Collapse */}
        <div className="sidebar-toggle">
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </aside>
    </>
  );
}
