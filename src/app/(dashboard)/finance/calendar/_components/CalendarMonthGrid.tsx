'use client';

import { AlertTriangle } from 'lucide-react';

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

interface Props {
  month: string;
  days: CalendarDay[];
  onDayClick: (day: CalendarDay) => void;
}

function getStartWeekday(month: string): number {
  const [y, m] = month.split('-').map(Number);
  // Monday = 0 ... Sunday = 6
  const jsDay = new Date(y, m - 1, 1).getDay(); // 0=Sun..6=Sat
  return (jsDay + 6) % 7;
}

function formatK(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return n.toFixed(0);
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

export default function CalendarMonthGrid({ month, days, onDayClick }: Props) {
  const startOffset = getStartWeekday(month);
  const totalCells = Math.ceil((days.length + startOffset) / 7) * 7;

  const cells: (CalendarDay | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (const d of days) cells.push(d);
  while (cells.length < totalCells) cells.push(null);

  return (
    <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ padding: 10, textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((d, i) => {
          if (!d) {
            return <div key={`empty-${i}`} style={{ minHeight: 100, background: 'var(--bg-secondary)', opacity: 0.3 }} />;
          }
          const hasOps = d.operations.length > 0 || d.recurring_previews.length > 0;
          const incomeTotal = d.day_income + d.day_planned_income + d.recurring_previews.filter((r) => r.op_type === 'income').reduce((s, r) => s + r.amount, 0);
          const expenseTotal = d.day_expense + d.day_planned_expense + d.recurring_previews.filter((r) => r.op_type === 'expense').reduce((s, r) => s + r.amount, 0);
          const day = Number(d.date.substring(8, 10));

          return (
            <div
              key={d.date}
              onClick={() => onDayClick(d)}
              style={{
                minHeight: 100,
                padding: 8,
                borderRight: (i + 1) % 7 === 0 ? 'none' : '1px solid var(--border-primary)',
                borderBottom: '1px solid var(--border-primary)',
                cursor: hasOps ? 'pointer' : 'default',
                background: d.is_today ? 'rgba(99,102,241,0.05)' : d.cash_gap ? 'rgba(220,38,38,0.04)' : 'var(--bg-primary)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                opacity: d.is_past && !hasOps ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{
                  fontWeight: d.is_today ? 700 : 500,
                  fontSize: 13,
                  color: d.is_today ? 'var(--accent, #6366f1)' : 'var(--text-primary)',
                }}>
                  {day}
                </span>
                {d.cash_gap && <AlertTriangle size={12} style={{ color: '#dc2626' }} />}
              </div>

              {incomeTotal > 0 && (
                <div style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: '#22c55e' }} />
                  + {formatK(incomeTotal)}
                </div>
              )}
              {expenseTotal > 0 && (
                <div style={{ fontSize: 11, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: '#ef4444' }} />
                  − {formatK(expenseTotal)}
                </div>
              )}
              {d.recurring_previews.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: 2, background: '#94a3b8' }} />
                  {d.recurring_previews.length}× регулярно
                </div>
              )}

              <div style={{ marginTop: 'auto', fontSize: 10, color: 'var(--text-secondary)', textAlign: 'right' }}>
                {Math.round(d.forecast_balance).toLocaleString('cs-CZ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
