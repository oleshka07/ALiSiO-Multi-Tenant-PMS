'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, AlertTriangle, CheckCircle, Calendar, Users } from 'lucide-react';

interface ExpectedItem {
  id: string; check_in: string; check_out: string; nights: number;
  adults: number; children: number; status: string; payment_status: string;
  total_price: number; source_name: string; guest_name: string;
  unit_name: string; category_type: string; category_name: string;
  net_paid: number; outstanding: number; days_until: number;
  urgency: 'overdue' | 'urgent' | 'soon' | 'upcoming';
}

interface Summary {
  total_expected: number; total_bookings: number;
  overdue: number; overdue_count: number;
  urgent: number; urgent_count: number;
  soon: number; soon_count: number;
  upcoming: number; upcoming_count: number;
}

interface TimelineItem { week: string; amount: number; count: number; }
interface CategoryItem { name: string; amount: number; count: number; }

function formatCZK(n: number): string { return `${Math.round(n).toLocaleString('cs-CZ')} CZK`; }

const URGENCY_STYLES: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  overdue: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444', label: 'Прострочено', icon: '🔴' },
  urgent: { bg: 'rgba(249,115,22,0.15)', color: '#f97316', label: 'Терміново (≤3 дн)', icon: '🟠' },
  soon: { bg: 'rgba(234,179,8,0.15)', color: '#eab308', label: 'Скоро (≤14 дн)', icon: '🟡' },
  upcoming: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', label: 'Майбутні', icon: '🟢' },
};

export default function ExpectedPaymentsPage() {
  const [items, setItems] = useState<ExpectedItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_expected: 0, total_bookings: 0, overdue: 0, overdue_count: 0, urgent: 0, urgent_count: 0, soon: 0, soon_count: 0, upcoming: 0, upcoming_count: 0 });
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [byCategory, setByCategory] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUrgency, setFilterUrgency] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/expected-payments');
      const data = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || {});
      setTimeline(data.timeline || []);
      setByCategory(data.byCategory || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = filterUrgency ? items.filter(i => i.urgency === filterUrgency) : items;
  const maxTimelineAmt = Math.max(...timeline.map(t => t.amount), 1);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={28} /> Очікувані оплати</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Неоплачені бронювання та прогнозовані надходження</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Всього очікується</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#6366f1', marginTop: '0.25rem' }}>{formatCZK(summary.total_expected)}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{summary.total_bookings} бронювань</div>
        </div>
        {(['overdue', 'urgent', 'soon', 'upcoming'] as const).map(key => {
          const s = URGENCY_STYLES[key];
          return (
            <div key={key} className="card" style={{ padding: '1.25rem', cursor: 'pointer', border: filterUrgency === key ? `2px solid ${s.color}` : undefined }}
              onClick={() => setFilterUrgency(filterUrgency === key ? '' : key)}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: s.color, marginTop: '0.25rem' }}>{formatCZK(summary[key])}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{summary[`${key}_count`]} бронювань</div>
            </div>
          );
        })}
      </div>

      {/* Timeline + Category */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Weekly Timeline */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>📅 Прогноз надходжень (по тижнях)</h3>
          {timeline.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Немає очікуваних оплат</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {timeline.map(t => (
                <div key={t.week} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '80px' }}>
                    {t.week.substring(5)}
                  </span>
                  <div style={{ flex: 1, height: 20, borderRadius: 4, background: 'var(--surface-hover)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(t.amount / maxTimelineAmt) * 100}%`, background: 'linear-gradient(90deg, #6366f1, #a78bfa)', borderRadius: 4, transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, minWidth: '100px', textAlign: 'right' }}>{formatCZK(t.amount)}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: '40px' }}>({t.count})</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By Category */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>🏷️ По категоріях</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {byCategory.map(c => (
              <div key={c.name} style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--surface-hover)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{c.name}</span>
                  <span style={{ fontWeight: 600, color: '#6366f1' }}>{formatCZK(c.amount)}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{c.count} бронювань</div>
              </div>
            ))}
            {byCategory.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Немає даних</p>}
          </div>
        </div>
      </div>

      {/* Bookings Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            <CheckCircle size={48} strokeWidth={1} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
            <p>Всі бронювання оплачені! 🎉</p>
          </div>
        ) : (
          <table className="data-table" style={{ fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th></th><th>Гість</th><th>Юніт</th><th>Заїзд</th><th>Ночей</th><th>Джерело</th>
                <th style={{ textAlign: 'right' }}>Повна ціна</th>
                <th style={{ textAlign: 'right' }}>Оплачено</th>
                <th style={{ textAlign: 'right' }}>Залишок</th>
                <th>Днів до</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const u = URGENCY_STYLES[item.urgency];
                const paidPct = item.total_price > 0 ? (item.net_paid / item.total_price * 100) : 0;
                return (
                  <tr key={item.id}>
                    <td><span style={{ padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, background: u.bg, color: u.color }}>{u.icon}</span></td>
                    <td style={{ fontWeight: 500 }}>{item.guest_name}</td>
                    <td>{item.unit_name}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.check_in}</td>
                    <td style={{ textAlign: 'center' }}>{item.nights}</td>
                    <td style={{ fontSize: '0.8rem' }}>{item.source_name}</td>
                    <td style={{ textAlign: 'right' }}>{formatCZK(item.total_price)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <div style={{ width: 40, height: 6, borderRadius: 3, background: 'var(--surface-hover)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${paidPct}%`, background: paidPct >= 100 ? '#22c55e' : '#eab308', borderRadius: 3 }} />
                        </div>
                        <span>{formatCZK(item.net_paid)}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: u.color }}>{formatCZK(item.outstanding)}</td>
                    <td style={{ textAlign: 'center', color: u.color, fontWeight: 600 }}>
                      {item.days_until < 0 ? `${Math.abs(item.days_until)}д тому` : item.days_until === 0 ? 'Сьогодні' : `${item.days_until}д`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
