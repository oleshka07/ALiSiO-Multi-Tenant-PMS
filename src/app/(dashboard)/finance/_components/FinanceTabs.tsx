'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sub-navigation for the finance module.
 *
 * Finance used to occupy 15 of the sidebar's 34 entries — nearly half the
 * product's navigation for one module, on a screen where most users spend their
 * day in the calendar. The entries live here instead; the sidebar keeps only
 * Overview and Operations.
 */
const TABS: { href: string; label: string }[] = [
  { href: '/finance', label: 'Огляд' },
  { href: '/finance/operations', label: 'Операції' },
  { href: '/finance/reports', label: 'Звіти' },
  { href: '/finance/calendar', label: 'Календар' },
  { href: '/finance/bank', label: 'Банк' },
  { href: '/finance/reconcile', label: 'Звірка' },
  { href: '/finance/clearing', label: 'Платформи' },
  { href: '/finance/receipts', label: 'Чеки з пошти' },
  { href: '/finance/expected-payments', label: 'Очікувані оплати' },
  { href: '/finance/accruals', label: 'Нарахування' },
  { href: '/finance/capex', label: 'CAPEX' },
  { href: '/finance/investors', label: 'Інвестори' },
  { href: '/finance/import', label: 'Імпорт' },
  { href: '/finance/history', label: 'Історія змін' },
  { href: '/finance/settings', label: 'Налаштування' },
];

export default function FinanceTabs() {
  const pathname = usePathname() || '';

  // Longest match wins, so /finance/reports/pnl highlights Звіти rather than
  // also matching the /finance overview prefix.
  const active = TABS.reduce<string>((best, tab) => {
    const hit = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    return hit && tab.href.length > best.length ? tab.href : best;
  }, '');

  return (
    <nav className="finance-tabs" aria-label="Розділи фінансів">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`finance-tab ${active === tab.href ? 'active' : ''}`}
          aria-current={active === tab.href ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
