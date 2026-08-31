'use client';

import { useT, usePlural } from '@core/i18n/client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  DollarSign,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Users,
  FileText,
  LogOut,
  X,
  Wallet,
  ClipboardList,
  Clock,
  ListChecks,
  MessageSquare,
  Code2,
  GitBranch,
  UserPlus,
  Globe,
  CheckSquare,
  Target,
  Printer,
  Presentation,
} from 'lucide-react';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { NAV_PERMISSION_MAP, ROLE_LABELS, ROLE_COLORS, hasPermission } from '@core/auth/permissions';
import type { Permission } from '@core/auth/permissions';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  permission?: Permission;
  /** Hidden unless the organization has this feature — see core/features.ts. */
  feature?: string;
  /** Hidden unless the organization has a property in one of these countries
   *  — the Czech Evidenční kniha has no business in a German-only menu. */
  countries?: string[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// Finance held 15 of these 34 entries — a hotel PMS whose navigation announced
// itself as an accounting product, on a screen where most people live in the
// calendar. Nothing was removed: those pages moved into the tab bar in the
// finance layout, and the sidebar keeps the two a receptionist opens daily.
// The same reasoning gathers the imports, the widget and the channel settings
// into one Integrations section instead of scattering them across three.
const navigation: NavSection[] = [
  {
    title: 'Основне',
    items: [
      { label: 'Dashboard', href: '/app/dashboard', icon: <LayoutDashboard size={20} />, permission: 'nav:dashboard', feature: 'dashboard' },
      { label: 'Календар', href: '/app/calendar', icon: <CalendarDays size={20} />, permission: 'nav:calendar' },
      { label: 'Бронювання', href: '/app/bookings', icon: <BookOpen size={20} />, permission: 'nav:bookings' },
      { label: 'Гості', href: '/app/guests', icon: <Users size={20} />, permission: 'nav:guests' },
      { label: 'Задачі', href: '/app/tasks', icon: <CheckSquare size={20} />, permission: 'nav:tasks', feature: 'tasks' },
      { label: 'Аркуші дня', href: '/app/day-sheets', icon: <Printer size={20} />, permission: 'nav:bookings', feature: 'day_sheets' },
      { label: 'Зали', href: '/app/events', icon: <Presentation size={20} />, permission: 'nav:bookings', feature: 'events' },
    ],
  },
  {
    title: 'Управління',
    items: [
      { label: 'Ціноутворення', href: '/app/pricing', icon: <DollarSign size={20} />, permission: 'nav:pricing' },
      { label: 'Аналітика продажів', href: '/app/reports', icon: <BarChart3 size={20} />, permission: 'nav:reports', feature: 'reports' },
      { label: 'Документи', href: '/app/documents', icon: <FileText size={20} />, permission: 'nav:documents', feature: 'invoicing' },
      { label: 'Evidenční kniha', href: '/app/guest-registry', icon: <ClipboardList size={20} />, permission: 'nav:guests', countries: ['CZ'] },
    ],
  },
  {
    title: 'Фінанси',
    items: [
      { label: 'Огляд', href: '/app/finance', icon: <Wallet size={20} />, permission: 'nav:finance', feature: 'accounting' },
      { label: 'Операції', href: '/app/finance/operations', icon: <ListChecks size={20} />, permission: 'nav:finance', feature: 'accounting' },
    ],
  },
  {
    title: 'Інтеграції',
    items: [
      { label: 'Канали', href: '/app/settings/channel-manager', icon: <Globe size={20} />, permission: 'nav:settings' },
      { label: 'Віджет бронювання', href: '/app/settings/booking-widget', icon: <Code2 size={20} />, permission: 'nav:settings', feature: 'booking_engine' },
      { label: 'Сайти', href: '/app/sites', icon: <Globe size={20} />, permission: 'nav:sites', feature: 'site_builder' },
    ],
  },
  {
    title: 'Система',
    items: [
      { label: 'Налаштування', href: '/app/settings', icon: <Settings size={20} />, permission: 'nav:settings' },
      { label: 'Журнал змін', href: '/app/audit', icon: <Clock size={20} />, permission: 'nav:settings' },
    ],
  },
];

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const plural = usePlural();
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const pathname = usePathname();
  const { user, features, organization, loading, logout } = useCurrentUser();

  // Close mobile sidebar on route change
  useEffect(() => {
    if (onMobileClose) onMobileClose();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch draft pool count for sidebar badge
  useEffect(() => {
    const fetchDrafts = async () => {
      try {
        const res = await fetch('/api/booking/drafts-count');
        if (res.ok) {
          const data = await res.json();
          setDraftCount(data.count || 0);
        }
      } catch { /* non-critical */ }
    };
    fetchDrafts();
    const interval = setInterval(fetchDrafts, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, []);

  // Finance access restrictions for non-owner users
  const [financeAccess, setFinanceAccess] = useState<{
    is_owner: boolean; allowed_tabs: string[];
  } | null>(null);

  useEffect(() => {
    if (!user || user.role === 'owner') return;
    fetch('/api/finance/access/my')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setFinanceAccess(data); })
      .catch(() => {});
  }, [user]);

  // Map finance route paths to tab IDs for filtering
  const FINANCE_TAB_MAP: Record<string, string> = {
    '/app/finance': 'overview',
    '/app/finance/operations': 'operations',
    '/app/finance/reports': 'reports',
    '/app/finance/expected-payments': 'expected-payments',
    '/app/finance/capex': 'capex',
    '/app/finance/history': 'history',
    '/app/finance/settings': 'settings',
  };

  // Filter navigation based on user permissions
  const filteredNavigation = navigation
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!user) return true;

        // For non-owner finance users: filter by allowed_tabs FIRST — independent
        // of item.permission, otherwise finance links without a permission field
        // would bypass the tab restriction and always show.
        if (financeAccess && !financeAccess.is_owner && item.href.startsWith('/app/finance')) {
          const tabId = FINANCE_TAB_MAP[item.href];
          if (tabId && tabId !== 'overview' && !financeAccess.allowed_tabs.includes(tabId)) {
            return false;
          }
        }

        if (item.permission && !hasPermission(user.permissions, item.permission)) return false;

        // The registry decides, the menu mirrors — same row the routes check.
        if (item.feature && !features[item.feature]) return false;

        // Jurisdiction-bound items appear only where their law applies.
        if (item.countries && !item.countries.some((c) => organization?.countries?.includes(c))) return false;
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`sidebar-backdrop ${mobileOpen ? 'visible' : ''}`}
        onClick={onMobileClose}
      />

      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">A</div>
          <span className="sidebar-logo-text">ALiSiO ERP</span>
          {/* Mobile close button */}
          {mobileOpen && (
            <button
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
          {filteredNavigation.map((section) => (
            <div key={section.title}>
              <div className="sidebar-section-title">{t(section.title)}</div>
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/app/dashboard' && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                  >
                    <span className="sidebar-nav-icon">{item.icon}</span>
                    <span className="sidebar-nav-label">{t(item.label)}</span>
                    {item.href === '/app/calendar' && draftCount > 0 && (
                      <span className="sidebar-draft-badge" title={`${draftCount} ${plural(draftCount, 'бронювань у чорновику')}`}>
                        {draftCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User info + Logout */}
        {user && !loading && (
          <div className="sidebar-user">
            <div className="sidebar-user-info">
              <div
                className="sidebar-user-avatar"
                style={{ background: ROLE_COLORS[user.role] }}
              >
                {user.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </div>
              <div className="sidebar-user-details">
                <div className="sidebar-user-name">{user.full_name}</div>
                <div className="sidebar-user-role">{t(ROLE_LABELS[user.role])}</div>
              </div>
            </div>
            <button
              className="sidebar-logout-btn"
              onClick={logout}
              title={t('Вийти')}
            >
              <LogOut size={16} />
            </button>
          </div>
        )}

        {/* Toggle (hidden on mobile via CSS) */}
        <div className="sidebar-toggle">
          <button
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
