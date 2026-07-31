'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, List, Settings, AlertTriangle } from 'lucide-react';
import CalendarMonthGrid from './_components/CalendarMonthGrid';
import DayOperationsModal from './_components/DayOperationsModal';

interface CalendarDay {
  date: string;
  operations: any[];
  recurring_previews: any[];
  day_income: number;
  day_expense: number;
  day_planned_income: number;
  day_planned_expense: number;
  forecast_balance: number;
  cash_gap: boolean;
  is_today: boolean;
  is_past: boolean;
}

interface CalendarData {
  month: string;
  starting_balance: number;
  ending_balance: number;
  total_income: number;
  total_expense: number;
  days: CalendarDay[];
  accounts: { id: string; name: string; currency: string; starting_balance: number }[];
}

function formatMonth(month: string): string {
  const names = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
  const [y, m] = month.split('-');
  return `${names[Number(m) - 1]} ${y}`;
}

function formatCZK(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [accountId, setAccountId] = useState<string>('');
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month });
      if (accountId) params.set('account_id', accountId);
      const res = await fetch(`/api/finance/calendar?${params}`);
      const json = await res.json();
      setData(json);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [month, accountId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const cashGapDays = useMemo(() => data?.days.filter((d) => d.cash_gap).length || 0, [data]);

  return (
    <div className="page-container" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          📅 Календар платежів
        </h1>
        <Link href="/app/finance/operations" style={{ ...btnSec, textDecoration: 'none' }}>
          <List size={14} /> Список операцій
        </Link>
        <Link href="/app/finance/settings" style={{ ...btnSec, textDecoration: 'none' }}>
          <Settings size={14} /> Налаштування
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
        <button onClick={() => setMonth(shiftMonth(month, -1))} style={navBtn} aria-label="Попередній місяць">
          <ChevronLeft size={18} />
        </button>
        <div style={{ fontSize: 20, fontWeight: 600, minWidth: 180, textAlign: 'center' }}>
          {formatMonth(month)}
        </div>
        <button onClick={() => setMonth(shiftMonth(month, 1))} style={navBtn} aria-label="Наступний місяць">
          <ChevronRight size={18} />
        </button>
        <button onClick={() => setMonth(new Date().toISOString().substring(0, 7))} style={btnSec}>
          Сьогодні
        </button>
        <div style={{ flex: 1 }} />
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={selectStyle}>
          <option value="">Усі рахунки</option>
          {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </div>

      {data && (
        <div style={summaryStyle}>
          <div>
            <div style={summaryLabel}>Початковий залишок</div>
            <div style={summaryValue}>{formatCZK(data.starting_balance)} CZK</div>
          </div>
          <div>
            <div style={summaryLabel}>Прогноз доходу</div>
            <div style={{ ...summaryValue, color: '#22c55e' }}>+ {formatCZK(data.total_income)}</div>
          </div>
          <div>
            <div style={summaryLabel}>Прогноз витрат</div>
            <div style={{ ...summaryValue, color: '#ef4444' }}>− {formatCZK(data.total_expense)}</div>
          </div>
          <div>
            <div style={summaryLabel}>Залишок на кінець</div>
            <div style={{ ...summaryValue, color: data.ending_balance < 0 ? '#ef4444' : 'var(--text-primary)' }}>
              {formatCZK(data.ending_balance)} CZK
            </div>
          </div>
          {cashGapDays > 0 && (
            <div style={{ marginLeft: 'auto', padding: '8px 14px', background: 'rgba(220,38,38,0.1)', borderRadius: 8, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={16} />
              <strong>{cashGapDays} дн.</strong> з cash-gap
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : data && (
        <CalendarMonthGrid
          month={month}
          days={data.days}
          onDayClick={(day) => setSelectedDay(day)}
        />
      )}

      {selectedDay && (
        <DayOperationsModal
          day={selectedDay}
          onClose={() => setSelectedDay(null)}
          onOperationSaved={() => { setSelectedDay(null); fetchData(); }}
        />
      )}
    </div>
  );
}

const btnSec: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  border: '1px solid var(--border-primary)', borderRadius: 8, fontSize: 13,
  color: 'var(--text-primary)', background: 'transparent', cursor: 'pointer',
};
const navBtn: React.CSSProperties = {
  padding: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
  borderRadius: 8, cursor: 'pointer', color: 'var(--text-primary)',
};
const selectStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border-primary)',
  borderRadius: 8, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const summaryStyle: React.CSSProperties = {
  display: 'flex', gap: 24, padding: 16, background: 'var(--bg-secondary)',
  borderRadius: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
};
const summaryLabel: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' };
const summaryValue: React.CSSProperties = { fontSize: 18, fontWeight: 600, marginTop: 4 };
