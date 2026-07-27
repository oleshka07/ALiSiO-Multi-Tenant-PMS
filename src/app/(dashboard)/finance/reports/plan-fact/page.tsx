'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Target, Pencil, Check } from 'lucide-react';

interface Row {
  id: string;
  name: string;
  icon: string | null;
  op_type: string | null;
  planned: number;
  actual: number;
  variance: number;
  variance_pct: number | null;
  budget_id: string | null;
}

interface Data { year: number; month: number; by: string; rows: Row[] }

function formatCZK(n: number): string {
  if (n === 0) return '0';
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function PlanFactPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  });
  const [by, setBy] = useState<'category' | 'project'>('category');
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [y, m] = period.split('-');
      const res = await fetch(`/api/finance/plan-fact?year=${y}&month=${m}&by=${by}`);
      setData(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [period, by]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function savePlan(row: Row, amount: number) {
    const [y, m] = period.split('-');
    const body: any = {
      year: Number(y), month: Number(m),
      planned_amount: amount,
    };
    if (by === 'category') body.category_id = row.id;
    else body.project_id = row.id;

    const res = await fetch('/api/finance/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { alert('Не вдалося зберегти'); return; }
    setEditing(null);
    fetchData();
  }

  const totals = data?.rows.reduce((acc, r) => ({
    planned: acc.planned + r.planned,
    actual: acc.actual + r.actual,
    variance: acc.variance + r.variance,
  }), { planned: 0, actual: 0, variance: 0 }) || { planned: 0, actual: 0, variance: 0 };

  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/finance/reports" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={24} /> План/Факт
        </h1>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary)', borderRadius: 8, padding: 3, border: '1px solid var(--border-primary)' }}>
          <button onClick={() => setBy('category')} style={{ ...tabBtn, ...(by === 'category' ? tabActive : {}) }}>По категоріях</button>
          <button onClick={() => setBy('project')} style={{ ...tabBtn, ...(by === 'project' ? tabActive : {}) }}>По проєктах</button>
        </div>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={input} />
      </div>

      {loading || !data ? (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, marginTop: 16, padding: 16, background: 'var(--bg-secondary)', borderRadius: 10 }}>
            <div><div style={lbl}>Всього план</div><div style={val}>{formatCZK(totals.planned)} CZK</div></div>
            <div><div style={lbl}>Всього факт</div><div style={val}>{formatCZK(totals.actual)} CZK</div></div>
            <div>
              <div style={lbl}>Відхилення</div>
              <div style={{ ...val, color: totals.variance >= 0 ? '#22c55e' : '#ef4444' }}>{formatCZK(totals.variance)} CZK</div>
            </div>
          </div>

          <div style={{ marginTop: 16, padding: 10, background: 'rgba(99,102,241,0.08)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            💡 Клік на значення «План» у рядку → введіть суму бюджету на цей місяць.
          </div>

          <div style={{ marginTop: 12, border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={{ ...th, textAlign: 'left' }}>{by === 'project' ? 'Проєкт' : 'Категорія'}</th>
                  <th style={th}>План</th>
                  <th style={th}>Факт</th>
                  <th style={th}>Відхилення</th>
                  <th style={th}>%</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Немає рядків</td></tr>
                ) : data.rows.map((r) => {
                  const isEditing = editing === r.id;
                  // Color logic: for income — actual ≥ planned = green; for expense — actual ≤ planned = green
                  const isIncome = r.op_type === 'income' || by === 'project';
                  const goodSign = isIncome
                    ? (r.planned === 0 ? null : r.actual >= r.planned)
                    : (r.planned === 0 ? null : r.actual <= r.planned);
                  const varColor = goodSign === null ? 'var(--text-secondary)' : goodSign ? '#22c55e' : '#ef4444';

                  return (
                    <tr key={r.id}>
                      <td style={{ ...tdLeft }}>
                        {r.icon ? <span style={{ marginRight: 6 }}>{r.icon}</span> : null}
                        {r.name}
                        {r.op_type && <span style={{ fontSize: 10, padding: '1px 6px', marginLeft: 6, background: 'var(--bg-secondary)', borderRadius: 3, color: 'var(--text-secondary)' }}>{r.op_type === 'income' ? 'дохід' : r.op_type === 'expense' ? 'витрата' : r.op_type}</span>}
                      </td>
                      <td style={{ ...td, cursor: 'pointer' }}
                          onClick={() => { if (!isEditing) { setEditing(r.id); setEditValue(String(r.planned || '')); } }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <input
                              type="number" step="1"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') savePlan(r, Number(editValue) || 0);
                                if (e.key === 'Escape') setEditing(null);
                              }}
                              autoFocus
                              style={{ ...input, width: 120, textAlign: 'right' }}
                            />
                            <button onClick={() => savePlan(r, Number(editValue) || 0)} style={{ ...iconBtn, color: '#22c55e' }}><Check size={14} /></button>
                          </div>
                        ) : (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatCZK(r.planned)}
                            <Pencil size={10} style={{ marginLeft: 6, color: 'var(--text-secondary)', opacity: 0.5 }} />
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatCZK(r.actual)}</td>
                      <td style={{ ...td, color: varColor, fontVariantNumeric: 'tabular-nums' }}>
                        {r.variance > 0 ? '+' : ''}{formatCZK(r.variance)}
                      </td>
                      <td style={{ ...td, color: 'var(--text-secondary)' }}>
                        {r.variance_pct !== null ? `${r.variance_pct}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>
                  <td style={tdLeft}>Разом</td>
                  <td style={td}>{formatCZK(totals.planned)}</td>
                  <td style={td}>{formatCZK(totals.actual)}</td>
                  <td style={{ ...td, color: totals.variance >= 0 ? '#22c55e' : '#ef4444' }}>
                    {totals.variance > 0 ? '+' : ''}{formatCZK(totals.variance)}
                  </td>
                  <td style={td}></td>
                </tr>
              </tfoot>
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
const input: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13,
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const tabBtn: React.CSSProperties = {
  padding: '6px 12px', border: 'none', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 6, fontSize: 13, fontWeight: 500,
};
const tabActive: React.CSSProperties = { background: 'var(--bg-primary)', color: 'var(--text-primary)', fontWeight: 600 };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = {
  textAlign: 'right', padding: '10px 12px', fontWeight: 600, fontSize: 12,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)',
};
const td: React.CSSProperties = { padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid var(--border-primary)' };
const tdLeft: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border-primary)' };
const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' };
const val: React.CSSProperties = { fontSize: 18, fontWeight: 700, marginTop: 4 };
const iconBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 4, cursor: 'pointer',
  color: 'var(--text-secondary)', borderRadius: 4,
};
