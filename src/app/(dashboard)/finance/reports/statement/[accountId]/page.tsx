'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText } from 'lucide-react';
import ExportButton from '../../../_components/ExportButton';

interface StatementItem {
  id: string;
  paid_at: string;
  op_type: string;
  amount: number;
  currency: string;
  comment: string | null;
  category_name: string | null;
  category_icon: string | null;
  project_name: string | null;
  counterparty_name: string | null;
  signed_amount: number;
  running_balance: number;
}

interface Data {
  account: { id: string; name: string; currency: string };
  from: string; to: string;
  opening: number; closing: number;
  totalIn: number; totalOut: number;
  items: StatementItem[];
}

function formatMoney(n: number, currency: string): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function defaultRange(): { from: string; to: string } {
  const t = new Date();
  const to = t.toISOString().substring(0, 10);
  const f = new Date(t.getFullYear(), t.getMonth() - 2, 1);
  const from = f.toISOString().substring(0, 10);
  return { from, to };
}

export default function StatementDetailPage() {
  const params = useParams<{ accountId: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(defaultRange());

  const fetchData = useCallback(async () => {
    if (!params.accountId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ account_id: params.accountId, from: range.from, to: range.to });
      const res = await fetch(`/api/finance/account-statement?${qs}`);
      setData(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [params.accountId, range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/finance/reports/statement" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={22} /> Виписка: {data?.account?.name || '...'}
        </h1>
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={input} />
        <span style={{ color: 'var(--text-secondary)' }}>—</span>
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={input} />
        <ExportButton
          endpoint="/api/finance/export/statement"
          params={{ account_id: params.accountId, from: range.from, to: range.to }}
        />
      </div>

      {loading || !data ? (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, marginTop: 16, padding: 16, background: 'var(--bg-secondary)', borderRadius: 10 }}>
            <div><div style={lbl}>Залишок на початок</div><div style={val}>{formatMoney(data.opening, data.account.currency)}</div></div>
            <div><div style={lbl}>Надходження</div><div style={{ ...val, color: '#22c55e' }}>+ {formatMoney(data.totalIn, data.account.currency)}</div></div>
            <div><div style={lbl}>Витрати</div><div style={{ ...val, color: '#ef4444' }}>− {formatMoney(data.totalOut, data.account.currency)}</div></div>
            <div><div style={lbl}>Залишок на кінець</div><div style={{ ...val, color: data.closing < 0 ? '#ef4444' : 'var(--text-primary)' }}>{formatMoney(data.closing, data.account.currency)}</div></div>
          </div>

          <div style={{ marginTop: 16, border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={th}>Дата</th>
                  <th style={{ ...th, textAlign: 'left' }}>Опис</th>
                  <th style={th}>Приход</th>
                  <th style={th}>Розхід</th>
                  <th style={th}>Залишок</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Операцій за цей період немає</td></tr>
                ) : data.items.map((item) => (
                  <tr key={item.id}>
                    <td style={td}>{item.paid_at.substring(0, 10)}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <div style={{ fontWeight: 500 }}>
                        {item.category_icon ? <span style={{ marginRight: 4 }}>{item.category_icon}</span> : null}
                        {item.counterparty_name || item.comment?.substring(0, 70) || item.category_name || '—'}
                      </div>
                      {(item.category_name || item.project_name) && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {item.category_name || ''}{item.category_name && item.project_name ? ' · ' : ''}{item.project_name || ''}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, color: '#22c55e' }}>{item.signed_amount > 0 ? formatMoney(item.signed_amount, item.currency) : ''}</td>
                    <td style={{ ...td, color: '#ef4444' }}>{item.signed_amount < 0 ? formatMoney(Math.abs(item.signed_amount), item.currency) : ''}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{formatMoney(item.running_balance, item.currency)}</td>
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
const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' };
const val: React.CSSProperties = { fontSize: 18, fontWeight: 700, marginTop: 4 };
