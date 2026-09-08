'use client';

/**
 * Звіти — один вхід (MASTER-PLAN §1.1, Блок 1.4).
 *
 * Аналітика, документи, фінанси, аркуші дня, книга гостей і журнал змін були
 * шістьма пунктами бічної панелі. Тут вони в двох групах, як у Hoteliera:
 * Financials і Misc. Кожен пункт за своїм правом і своїм ключем модуля — той
 * самий рядок `organization_features`, який читають маршрути; пункт
 * вимкненого модуля не показується, а не «показується сірим».
 */
import Link from 'next/link';
import { useT } from '@core/i18n/client';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { hasPermission, type Permission } from '@core/auth/permissions';
import { EmptyState } from '@/components/ui/State';
import {
  BarChart3, FileText, Wallet, Landmark, Printer, ClipboardList, Clock, Receipt, ChevronRight,
} from 'lucide-react';

interface ReportLink {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
  permission: Permission;
  feature?: string;
  countries?: string[];
}

const GROUPS: { title: string; items: ReportLink[] }[] = [
  {
    title: 'Фінанси',
    items: [
      { title: 'Аналітика продажів', desc: 'Виручка, заповненість, ADR і канали за період', href: '/app/reports/sales', icon: <BarChart3 size={20} />, permission: 'nav:reports', feature: 'reports' },
      { title: 'Туристичний збір', desc: 'Скільки збору нараховано за період — для звіту громаді', href: '/app/reports/city-tax', icon: <Receipt size={20} />, permission: 'nav:reports', feature: 'reports' },
      { title: 'Документи', desc: 'Фактури, сторно, пакети ISDOC, закриття періоду', href: '/app/documents', icon: <FileText size={20} />, permission: 'nav:documents', feature: 'invoicing' },
      { title: 'Облік і фінанси', desc: 'Операції, P&L, cashflow, витрати, бюджети', href: '/app/finance', icon: <Wallet size={20} />, permission: 'nav:finance', feature: 'accounting' },
      { title: 'Фінансові звіти', desc: 'Баланс, план-факт, проєкти, виписки', href: '/app/finance/reports', icon: <Landmark size={20} />, permission: 'nav:finance', feature: 'accounting' },
    ],
  },
  {
    title: 'Інше',
    items: [
      { title: 'Аркуші дня', desc: 'Друковані списки для зміни: заїзди, виїзди, сніданки, прибирання', href: '/app/day-sheets', icon: <Printer size={20} />, permission: 'nav:bookings', feature: 'day_sheets' },
      { title: 'Evidenční kniha', desc: 'Книга гостей для чеської поліції та статистики', href: '/app/guest-registry', icon: <ClipboardList size={20} />, permission: 'nav:guests', countries: ['CZ'] },
      { title: 'Журнал змін', desc: 'Хто, коли і що змінив — по кожній броні й налаштуванню', href: '/app/audit', icon: <Clock size={20} />, permission: 'nav:settings' },
    ],
  },
];

export default function ReportsHubPage() {
  const t = useT();
  const { user, features, organization, loading } = useCurrentUser();

  const visible = GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        if (!user) return false;
        if (!hasPermission(user.permissions, i.permission)) return false;
        if (i.feature && !features[i.feature]) return false;
        if (i.countries && !i.countries.some((c) => organization?.countries?.includes(c))) return false;
        return true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <div className="app-content">
        <div className="page-header">
          <div>
            <h2 className="page-title">{t('Звіти')}</h2>
            <div className="page-subtitle">{t('Усе, що рахується і друкується, — в одному місці')}</div>
          </div>
        </div>

        {!loading && visible.length === 0 && (
          <EmptyState
            title={t('Для вашої ролі звітів немає')}
            hint={t('Звіти відкриваються правами ролі та модулями готелю. Попросіть власника дати доступ або увімкнути модуль.')}
          />
        )}

        {visible.map((group) => (
          <section key={group.title} style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-tertiary)', margin: '0 0 10px' }}>{t(group.title)}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
                  <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', padding: '14px 16px' }}>
                    <div className="stat-icon blue">{item.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t(item.title)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{t(item.desc)}</div>
                    </div>
                    <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
