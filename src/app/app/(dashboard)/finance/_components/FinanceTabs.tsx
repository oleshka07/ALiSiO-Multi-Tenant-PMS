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
  { href: '/app/finance', label: 'Огляд' },
  { href: '/app/finance/operations', label: 'Операції' },
  { href: '/app/finance/reports', label: 'Звіти' },
  { href: '/app/finance/calendar', label: 'Календар' },
  { href: '/app/finance/bank', label: 'Банк' },
  { href: '/app/finance/reconcile', label: 'Звірка' },
  { href: '/app/finance/clearing', label: 'Платформи' },
  { href: '/app/finance/receipts', label: 'Чеки з пошти' },
  { href: '/app/finance/expected-payments', label: 'Очікувані оплати' },
  { href: '/app/finance/accruals', label: 'Нарахування' },
  { href: '/app/finance/capex', label: 'CAPEX' },
  { href: '/app/finance/investors', label: 'Інвестори' },
  { href: '/app/finance/import', label: 'Імпорт' },
  { href: '/app/finance/history', label: 'Історія змін' },
  { href: '/app/finance/settings', label: 'Налаштування' },
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
