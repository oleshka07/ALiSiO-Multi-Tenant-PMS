'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, ShoppingBag, AlertOctagon, CheckCircle2 } from 'lucide-react';

interface PaidService {
  source_table: 'booking_service_orders' | 'service_orders';
  order_id: string;
  reservation_id: string | null;
  service_id: string;
  service_name: string | null;
  quantity: number;
  total_price: number;
  payment_id: string | null;
  payment_status: string;
  service_date: string | null;
  options_json: string | null;
  created_at: string;
  guest_name: string | null;
  unit_name: string | null;
  fin_operation_id: string | null;
}

interface ApiResponse {
  services: PaidService[];
  count: number;
  totals_by_currency: Record<string, number>;
  with_fin_operation: number;
  orphan_count: number;
}

function fmtCZK(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} CZK`;
}

function isoDate(d: Date): string {
  return d.toISOString().substring(0, 10);
}

function describeOptions(options_json: string | null, service_date: string | null): string {
  if (!options_json) return service_date || '';
  try {
    const opts = JSON.parse(options_json);
    if (typeof opts.startHour === 'number' && typeof opts.hours === 'number') {
      const end = opts.startHour + opts.hours;
      return `${service_date || ''} ${opts.startHour}:00–${end}:00`;
    }
    return service_date || '';
  } catch { return service_date || ''; }
}

export default function PaidServicesPage() {
  const today = new Date();
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 3);

  const [from, setFrom] = useState(isoDate(monthAgo));
  const [to, setTo] = useState(isoDate(today));
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (onlyOrphans) params.set('only_orphans', '1');
      const res = await fetch(`/api/finance/paid-services?${params}`);
      const json = await res.json();
      setData(json);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [from, to, onlyOrphans]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, PaidService[]>();
    for (const r of data.services) {
      const day = (r.created_at || '').substring(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  return (
    <div className="page-container" style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/finance" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShoppingBag size={24} /> Оплачені послуги
        </h1>
        <button onClick={fetchRows} disabled={loading} style={{ ...btn, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} /> Оновити
        </button>
      </div>

      <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
        Усі послуги, оплачені через віджет (Booking) або гостьову сторінку, з позначкою чи створено fin_operation.
        Orphan-рядки (без fin_operation) можна відновити в окремій вкладці «Orphans».
      </p>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Від
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...input, marginLeft: 6 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          До
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...input, marginLeft: 6 }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={onlyOrphans} onChange={(e) => setOnlyOrphans(e.target.checked)} />
          Тільки orphans
        </label>
        <Link href="/finance/payments/orphans" style={{ ...btn, color: '#a855f7', borderColor: '#a855f7', textDecoration: 'none', marginLeft: 'auto' }}>
          <AlertOctagon size={14} /> Перейти до Orphans
        </Link>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : !data || data.services.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-primary)', borderRadius: 10 }}>
          Оплачених послуг за цей період не знайдено
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex', gap: 16, marginBottom: 12, padding: 12,
            background: 'var(--bg-secondary)', borderRadius: 8, flexWrap: 'wrap', fontSize: 13,
          }}>
            <span>Записів: <b>{data.count}</b></span>
            <span style={{ color: '#22c55e' }}>З fin_operation: <b>{data.with_fin_operation}</b></span>
            <span style={{ color: data.orphan_count > 0 ? '#a855f7' : 'var(--text-secondary)' }}>
              Orphan: <b>{data.orphan_count}</b>
            </span>
            {Object.entries(data.totals_by_currency).map(([cur, val]) => (
              <span key={cur} style={{ marginLeft: 'auto', fontWeight: 600 }}>
                Сума: {val.toLocaleString('cs-CZ', { minimumFractionDigits: 2 })} {cur}
              </span>
            ))}
          </div>

          {grouped.map(([day, rows]) => {
            const dayTotal = rows.reduce((s, r) => s + (r.total_price || 0), 0);
            return (
              <div key={day} style={{ marginBottom: 16, border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{
                  padding: '8px 12px', background: 'var(--bg-secondary)', fontWeight: 600,
                  fontSize: 13, display: 'flex', justifyContent: 'space-between',
                }}>
                  <span>{day}</span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {rows.length} зап. · {fmtCZK(dayTotal)}
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)' }}>
                      <th style={th}>Час</th>
                      <th style={th}>Гість / Юніт</th>
                      <th style={th}>Послуга</th>
                      <th style={{ ...th, textAlign: 'right' }}>К-сть</th>
                      <th style={{ ...th, textAlign: 'right' }}>Сума</th>
                      <th style={th}>Джерело</th>
                      <th style={th}>fin_operation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.order_id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                        <td style={{ ...td, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {r.created_at?.substring(11, 16)}
                        </td>
                        <td style={td}>
                          <div>{r.guest_name || '—'}</div>
                          {r.unit_name && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.unit_name}</div>}
                        </td>
                        <td style={td}>
                          <div>{r.service_name || <code>{r.service_id}</code>}</div>
                          {(r.service_date || r.options_json) && (
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                              {describeOptions(r.options_json, r.service_date)}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.quantity}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {fmtCZK(r.total_price)}
                        </td>
                        <td style={{ ...td, fontSize: 11, color: 'var(--text-secondary)' }}>
                          {r.source_table === 'booking_service_orders' ? 'Widget' : 'Guest page'}
                        </td>
                        <td style={td}>
                          {r.fin_operation_id ? (
                            <span title={r.fin_operation_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#22c55e', fontSize: 12, fontWeight: 600 }}>
                              <CheckCircle2 size={14} /> ✓
                            </span>
                          ) : (
                            <Link
                              href="/finance/payments/orphans"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#a855f7', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                            >
                              <AlertOctagon size={14} /> orphan
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

const backLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: 8,
  background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none',
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, fontWeight: 500,
  cursor: 'pointer', background: 'transparent',
};
const input: React.CSSProperties = {
  padding: '5px 8px', border: '1px solid var(--border-primary)', borderRadius: 6,
  fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
