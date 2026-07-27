'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Wallet, TrendingUp, TrendingDown, BarChart3, AlertTriangle, CheckCircle, Settings, ListChecks, Repeat, AlertOctagon, ShoppingBag } from 'lucide-react';
import { useDevice } from '@/lib/useDevice';
import MobileFinanceOverview from '@/components/mobile/pages/MobileFinanceOverview';
import ReconcileWidget from './_components/ReconcileWidget';

interface KPI {
  revenue: number;
  expenses: number;
  ebitda: number;
  margin: number;
  capex: number;
  depreciation: number;
  pendingAccruals: number;
  expectedPayments: number;
}

interface MonthlyData {
  month: string;
  revenue: number;
  expenses: number;
  ebitda: number;
}

interface BUBreakdown {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  capex: number;
}

interface Alert {
  metric: string;
  value: number;
  threshold: number;
  status: string;
}

interface RecentTransaction {
  id: string;
  amount: number;
  description: string;
  expense_date: string;
  category_name: string;
  category_icon: string;
  category_color: string;
  bu_name: string;
}

interface OverviewData {
  month: string;
  kpi: KPI;
  monthlyData: MonthlyData[];
  buBreakdown: BUBreakdown[];
  alerts: Alert[];
  recentTransactions: RecentTransaction[];
}

function formatCZK(amount: number): string {
  if (amount === 0) return '0 CZK';
  const prefix = amount < 0 ? '-' : '';
  return `${prefix}${Math.abs(Math.round(amount)).toLocaleString('cs-CZ')} CZK`;
}

function getMonthLabel(m: string): string {
  const [, month] = m.split('-');
  const names = ['', 'Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
  return names[parseInt(month)] || m;
}

export default function FinanceOverviewPage() {
  const { isMobile } = useDevice();
  if (isMobile) return <MobileFinanceOverview />;

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => new Date().toISOString().substring(0, 7));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/overview?month=${month}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Failed to load finance overview', e);
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header"><h1>💰 Фінанси — Огляд</h1></div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (!data) return <div className="page-container"><p>Помилка завантаження</p></div>;

  const maxBar = Math.max(...data.monthlyData.map(d => Math.max(d.revenue, d.expenses)), 1);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Wallet size={28} /> Фінанси — Огляд
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            CEO Dashboard — зведена фінансова панель
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
          <Link
            href="/finance/operations"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0.5rem 1rem', borderRadius: '8px',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-primary)', textDecoration: 'none', fontSize: 14,
            }}
          >
            <ListChecks size={16} /> Операції
          </Link>
          <Link
            href="/finance/clearing"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0.5rem 1rem', borderRadius: '8px',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-primary)', textDecoration: 'none', fontSize: 14,
            }}
          >
            <Repeat size={16} /> Clearing
          </Link>
          <Link
            href="/finance/payments/services"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0.5rem 1rem', borderRadius: '8px',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-primary)', textDecoration: 'none', fontSize: 14,
            }}
            title="Усі оплачені послуги по датах + статус fin_operation"
          >
            <ShoppingBag size={16} /> Послуги
          </Link>
          <Link
            href="/finance/payments/orphans"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0.5rem 1rem', borderRadius: '8px',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-primary)', textDecoration: 'none', fontSize: 14,
            }}
            title="Знайти платежі без fin_operation"
          >
            <AlertOctagon size={16} /> Orphans
          </Link>
          <Link
            href="/finance/settings"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            <Settings size={16} /> Налаштування
          </Link>
        </div>
      </div>

      <ReconcileWidget />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <KPICard
          title="Дохід"
          value={formatCZK(data.kpi.revenue)}
          icon={<TrendingUp size={20} />}
          color="#22c55e"
        />
        <KPICard
          title="Витрати"
          value={formatCZK(data.kpi.expenses)}
          icon={<TrendingDown size={20} />}
          color="#ef4444"
        />
        <KPICard
          title="EBITDA"
          value={formatCZK(data.kpi.ebitda)}
          icon={<BarChart3 size={20} />}
          color={data.kpi.ebitda >= 0 ? '#22c55e' : '#ef4444'}
        />
        <KPICard
          title="Маржа"
          value={`${data.kpi.margin}%`}
          icon={<Wallet size={20} />}
          color="#8b5cf6"
        />
        <KPICard
          title="CAPEX"
          value={formatCZK(data.kpi.capex)}
          icon={<TrendingDown size={20} />}
          color="#0ea5e9"
        />
        {data.kpi.depreciation > 0 && (
          <KPICard
            title="Амортизація/міс"
            value={formatCZK(data.kpi.depreciation)}
            icon={<BarChart3 size={20} />}
            color="#f59e0b"
          />
        )}
        {data.kpi.pendingAccruals > 0 && (
          <KPICard
            title="Pending Accruals"
            value={formatCZK(data.kpi.pendingAccruals)}
            icon={<AlertTriangle size={20} />}
            color="#eab308"
          />
        )}
        {data.kpi.expectedPayments > 0 && (
          <KPICard
            title="Очікується оплат"
            value={formatCZK(data.kpi.expectedPayments)}
            icon={<TrendingUp size={20} />}
            color="#6366f1"
          />
        )}
      </div>

      {/* Chart + BU Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Revenue vs Expenses Chart */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', fontWeight: 600 }}>📊 Дохід vs Витрати по місяцях</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', height: '200px' }}>
            {data.monthlyData.map((d) => (
              <div key={d.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '160px', width: '100%', justifyContent: 'center' }}>
                  <div
                    style={{
                      width: '40%',
                      height: `${Math.max((d.revenue / maxBar) * 160, 2)}px`,
                      background: 'linear-gradient(to top, #22c55e, #4ade80)',
                      borderRadius: '4px 4px 0 0',
                      minHeight: '2px',
                    }}
                    title={`Дохід: ${formatCZK(d.revenue)}`}
                  />
                  <div
                    style={{
                      width: '40%',
                      height: `${Math.max((d.expenses / maxBar) * 160, 2)}px`,
                      background: 'linear-gradient(to top, #ef4444, #f87171)',
                      borderRadius: '4px 4px 0 0',
                      minHeight: '2px',
                    }}
                    title={`Витрати: ${formatCZK(d.expenses)}`}
                  />
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{getMonthLabel(d.month)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem', justifyContent: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#22c55e', display: 'inline-block' }} /> Дохід
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#ef4444', display: 'inline-block' }} /> Витрати
            </span>
          </div>
        </div>

        {/* BU Breakdown */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>🏢 По бізнес-юнітах</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {data.buBreakdown.map((bu) => (
              <div key={bu.id} style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--surface-hover)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{bu.name}</span>
                  <span style={{ fontSize: '0.8rem', color: bu.revenue - bu.expenses >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                    {formatCZK(bu.revenue - bu.expenses)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span>↗ {formatCZK(bu.revenue)}</span>
                  <span>↘ {formatCZK(bu.expenses)}</span>
                  {bu.capex > 0 && <span>🏗 {formatCZK(bu.capex)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alerts + Recent Transactions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
        {/* Alerts */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>⚠️ Контрольні точки</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {data.alerts.map((alert, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem',
                borderRadius: '8px', background: alert.status === 'RED' ? 'rgba(239,68,68,0.1)' : alert.status === 'YELLOW' ? 'rgba(234,179,8,0.1)' : 'rgba(34,197,94,0.1)',
              }}>
                {alert.status === 'GREEN' ? <CheckCircle size={18} color="#22c55e" /> : <AlertTriangle size={18} color={alert.status === 'RED' ? '#ef4444' : '#eab308'} />}
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{alert.metric}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{alert.value} (поріг: {Math.round(alert.threshold)})</div>
                </div>
              </div>
            ))}
            {data.alerts.length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Немає активних попереджень</p>
            )}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>📋 Останні транзакції</h3>
          {data.recentTransactions.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem' }}>
              Ще немає транзакцій. Додайте першу витрату через розділ &quot;Витрати&quot;.
            </p>
          ) : (
            <table className="data-table" style={{ fontSize: '0.875rem' }}>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Категорія</th>
                  <th>Опис</th>
                  <th>BU</th>
                  <th style={{ textAlign: 'right' }}>Сума</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.expense_date}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>{tx.category_icon}</span>
                        <span>{tx.category_name}</span>
                      </span>
                    </td>
                    <td>{tx.description}</td>
                    <td>{tx.bu_name || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: tx.amount >= 0 ? '#22c55e' : '#ef4444' }}>
                      {formatCZK(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function KPICard({ title, value, icon, color }: { title: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div style={{
        width: 44, height: 44, borderRadius: '12px',
        background: `${color}15`, color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}
