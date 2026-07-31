'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FolderKanban } from 'lucide-react';

interface Project {
  project_id: string;
  project_name: string;
  is_shared: number;
  income_by_month: Record<string, number>;
  expense_by_month: Record<string, number>;
  profit_by_month: Record<string, number>;
  income_total: number;
  expense_total: number;
  profit_total: number;
  margin_pct: number | null;
}

interface Data {
  months: string[];
  projects: Project[];
  totals: { income: number; expense: number; profit: number };
  basis: string;
}

function monthLabel(m: string): string {
  const names = ['Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру'];
  const [y, mm] = m.split('-');
  return `${names[Number(mm) - 1]} ${y.slice(2)}`;
}

function formatK(n: number): string {
  if (n === 0) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return n.toFixed(0);
}

function defaultRange(): { from: string; to: string } {
  const t = new Date();
  const to = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  const f = new Date(t.getFullYear(), t.getMonth() - 5, 1);
  const from = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
  return { from, to };
}

export default function ProjectProfitabilityPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(defaultRange());
  const [basis, setBasis] = useState<'paid' | 'accrued'>('paid');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, basis });
      const res = await fetch(`/api/finance/project-profitability?${params}`);
      setData(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [range, basis]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="page-container" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/app/finance/reports" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderKanban size={24} /> Прибутковість проєктів
        </h1>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary)', borderRadius: 8, padding: 3, border: '1px solid var(--border-primary)' }}>
          <button onClick={() => setBasis('paid')} style={{ ...tabBtn, ...(basis === 'paid' ? tabActive : {}) }}>По факту</button>
          <button onClick={() => setBasis('accrued')} style={{ ...tabBtn, ...(basis === 'accrued' ? tabActive : {}) }}>По нарахуванню</button>
        </div>
        <input type="month" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={input} />
        <span style={{ color: 'var(--text-secondary)' }}>—</span>
        <input type="month" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={input} />
      </div>

      {loading || !data ? (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, marginTop: 16, padding: 16, background: 'var(--bg-secondary)', borderRadius: 10 }}>
            <div><div style={lbl}>Дохід усього</div><div style={{ ...val, color: '#22c55e' }}>{formatK(data.totals.income)} CZK</div></div>
            <div><div style={lbl}>Витрати усього</div><div style={{ ...val, color: '#ef4444' }}>{formatK(data.totals.expense)} CZK</div></div>
            <div><div style={lbl}>Прибуток</div><div style={{ ...val, color: data.totals.profit >= 0 ? '#22c55e' : '#ef4444' }}>{formatK(data.totals.profit)} CZK</div></div>
          </div>

          <div style={{ marginTop: 16, overflowX: 'auto', border: '1px solid var(--border-primary)', borderRadius: 10 }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-secondary)', zIndex: 2, minWidth: 200 }}>Проєкт</th>
                  {data.months.map((m) => <th key={m} style={th}>{monthLabel(m)}</th>)}
                  <th style={th}>Дохід</th>
                  <th style={th}>Витрата</th>
                  <th style={th}>Прибуток</th>
                  <th style={th}>Маржа %</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.project_id}>
                    <td style={{ ...tdLeft, position: 'sticky', left: 0, background: 'var(--bg-primary)' }}>
                      {p.project_name}
                      {p.is_shared ? <span style={{ fontSize: 10, padding: '1px 6px', marginLeft: 6, background: 'var(--bg-secondary)', borderRadius: 3, color: 'var(--text-secondary)' }}>shared</span> : null}
                    </td>
                    {data.months.map((m) => {
                      const v = p.profit_by_month[m] || 0;
                      return <td key={m} style={{ ...td, color: v === 0 ? 'var(--text-secondary)' : v > 0 ? '#22c55e' : '#ef4444' }}>{formatK(v)}</td>;
                    })}
                    <td style={{ ...td, color: '#22c55e' }}>{formatK(p.income_total)}</td>
                    <td style={{ ...td, color: '#ef4444' }}>{formatK(p.expense_total)}</td>
                    <td style={{ ...td, fontWeight: 700, color: p.profit_total >= 0 ? '#22c55e' : '#ef4444' }}>{formatK(p.profit_total)}</td>
                    <td style={{ ...td, color: 'var(--text-secondary)', fontSize: 12 }}>{p.margin_pct !== null ? `${p.margin_pct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const backLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: 8,
  background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none',
};
const tabBtn: React.CSSProperties = {
  padding: '6px 12px', border: 'none', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 6, fontSize: 13, fontWeight: 500,
};
const tabActive: React.CSSProperties = { background: 'var(--bg-primary)', color: 'var(--text-primary)', fontWeight: 600 };
const input: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' };
const th: React.CSSProperties = {
  textAlign: 'right', padding: '10px 12px', fontWeight: 600, fontSize: 12,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-primary)' };
const tdLeft: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border-primary)', whiteSpace: 'nowrap' };
const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' };
const val: React.CSSProperties = { fontSize: 18, fontWeight: 700, marginTop: 4 };
