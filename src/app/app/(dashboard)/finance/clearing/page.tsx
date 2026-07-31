'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Wallet, RefreshCw, Search, ArrowLeft, FileSpreadsheet, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';

interface ClearingAccount {
  id: string;
  name: string;
  currency: string;
  color: string | null;
  expected: number;
  in_statement: number;
  paid_total: number;
  outstanding: number;
  receivable_count: number;
  fx_rate_to_czk: number | null;
  outstanding_czk: number | null;
  paid_total_czk: number | null;
}

interface Receivable {
  id: string;
  reservation_id: string;
  external_reservation_id: string | null;
  channel_source: string;
  gross_amount: number;
  actual_gross: number | null;
  expected_commission: number;
  expected_net: number;
  actual_commission: number | null;
  actual_net: number | null;
  currency: string;
  check_in: string;
  check_out: string;
  status: string;
  statement_payout_id: string | null;
  statement_payout_date: string | null;
  guest_name: string;
  unit_name: string | null;
  clearing_account_name: string;
  clearing_account_color: string | null;
  reservation_total_czk: number | null;
  fx_rate_to_czk: number | null;
  expected_net_czk: number | null;
  gross_diff_source_currency: number | null;
  reservation_vs_receivable_diff_czk: number | null;
  is_orphan: number;
}

interface UploadResultExtended extends UploadResult {
  orphans_created?: number;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  expected:     { label: 'Очікується',           color: '#6b7280' },
  in_statement: { label: 'У виписці',            color: '#3b82f6' },
  paid:         { label: '✓ Сплачено',           color: '#22c55e' },
  cancelled:    { label: 'Скасовано',            color: '#ef4444' },
};

function fmtMoney(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

interface UploadResult {
  channel: string;
  file_name: string;
  total_rows: number;
  applied: number;
  cancelled: number;
  unmatched: number;
  outcomes: Array<{
    external_reservation_id: string;
    guest_name: string | null;
    check_in: string;
    outcome: string;
    amount?: number;
    currency?: string;
    message?: string;
  }>;
}

interface UploadHistoryRow {
  id: string;
  channel: string;
  file_name: string;
  row_count: number;
  applied_count: number;
  cancelled_count: number;
  unmatched_count: number;
  created_at: string;
}

export default function ClearingPage() {
  const [accounts, setAccounts] = useState<ClearingAccount[]>([]);
  const [totals, setTotals] = useState<{ outstanding: Record<string, number>; paid_total: Record<string, number>; receivable_count: number } | null>(null);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('expected');
  const [showCzkDetails, setShowCzkDetails] = useState(false);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadChannel, setUploadChannel] = useState<'auto' | 'booking' | 'vrbo' | 'airbnb'>('auto');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/clearing');
      const json = await res.json();
      setAccounts(json.accounts || []);
      setTotals(json.totals || null);
    } catch (e) { console.error(e); }
  }, []);

  const fetchReceivables = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeAccountId) params.set('clearing_account_id', activeAccountId);
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/finance/clearing/receivables?${params}`);
      const json = await res.json();
      setReceivables(json.items || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [activeAccountId, statusFilter, search]);

  const fetchUploadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/clearing/statements');
      const json = await res.json();
      setUploadHistory(json.items || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
  useEffect(() => { fetchReceivables(); }, [fetchReceivables]);
  useEffect(() => { fetchUploadHistory(); }, [fetchUploadHistory]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('channel', uploadChannel);
      const res = await fetch('/api/finance/clearing/statements', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        alert(`Помилка: ${json.error || 'upload failed'}`);
        return;
      }
      setUploadResult(json);
      fetchAccounts();
      fetchReceivables();
      fetchUploadHistory();
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleBackfill() {
    if (!confirm('Перерахувати receivables по всіх існуючих бронюваннях? (безпечно, idempotent)')) return;
    setRefreshing(true);
    try {
      const res = await fetch('/api/finance/clearing/backfill', { method: 'POST' });
      const json = await res.json();
      if (res.ok) alert(`✓ Опрацьовано: ${json.count} receivable(s)`);
      else alert(`Помилка: ${json.error}`);
      fetchAccounts(); fetchReceivables();
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
    setRefreshing(false);
  }

  return (
    <div className="page-container" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/app/finance" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wallet size={24} /> Транзитні рахунки (Clearing)
        </h1>
        <button onClick={handleBackfill} disabled={refreshing} style={{ ...btn, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} /> Перерахувати
        </button>
      </div>

      <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
        Кожна платформа = віртуальний рахунок-посередник. Тут видно скільки кожна платформа нам винна
        («очікується») і що вже надійшло. Як надійде виписка — receivables перейдуть у статус «У виписці»,
        як банк зарахує — у «Сплачено».
      </p>

      {/* Account cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 16 }}>
        <button
          onClick={() => setActiveAccountId(null)}
          style={{ ...accountCard, borderColor: activeAccountId === null ? 'var(--text-primary)' : 'var(--border-primary)' }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Усі рахунки</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{totals?.receivable_count ?? 0} bookings</div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            {totals && Object.entries(totals.outstanding).map(([cur, val]) => (
              <div key={cur}>Outstanding: <b>{fmtMoney(val, cur)}</b></div>
            ))}
            {(!totals || Object.keys(totals.outstanding).length === 0) && <span>немає очікуваних</span>}
          </div>
        </button>
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => setActiveAccountId(a.id)}
            style={{ ...accountCard, borderColor: activeAccountId === a.id ? a.color || 'var(--text-primary)' : 'var(--border-primary)' }}
          >
            <div style={{ fontSize: 11, color: a.color || 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>
              {a.name}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: a.outstanding > 0 ? a.color || 'inherit' : 'var(--text-secondary)' }}>
              {fmtMoney(a.outstanding, a.currency)}
            </div>
            {a.outstanding_czk != null && a.currency !== 'CZK' && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                ≈ {fmtMoney(a.outstanding_czk, 'CZK')}
                {a.fx_rate_to_czk && <span style={{ opacity: 0.7 }}> @ {a.fx_rate_to_czk.toFixed(3)}</span>}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <div>Очікується: <b>{fmtMoney(a.expected, a.currency)}</b> ({a.receivable_count})</div>
              {a.in_statement > 0 && <div style={{ color: '#3b82f6' }}>У виписці: <b>{fmtMoney(a.in_statement, a.currency)}</b></div>}
              {a.paid_total > 0 && <div style={{ color: '#22c55e' }}>Сплачено всього: <b>{fmtMoney(a.paid_total, a.currency)}</b></div>}
            </div>
          </button>
        ))}
      </div>

      {/* Statement upload */}
      <div style={{ marginTop: 24, padding: 16, border: '1px solid var(--border-primary)', borderRadius: 10, background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <FileSpreadsheet size={20} color="#16a34a" />
          <h2 style={{ margin: 0, fontSize: 16 }}>Завантажити виписку платформи</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <select value={uploadChannel} onChange={(e) => setUploadChannel(e.target.value as any)} style={input}>
            <option value="auto">Авто-визначення</option>
            <option value="booking">Booking.com (CSV)</option>
            <option value="vrbo">VRBO (CSV)</option>
            <option value="airbnb">Airbnb (CSV)</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
            disabled={uploading}
            style={{ ...input, padding: 6 }}
          />
          {uploading && <span style={{ color: 'var(--text-secondary)' }}>Обробка…</span>}
        </div>
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 0 }}>
          Завантаж CSV з тижневої (Booking) або місячної (VRBO) виписки. Receivables які матчаться → переходять у статус «У виписці».
        </p>
      </div>

      {/* Upload result */}
      {uploadResult && (
        <div style={{ marginTop: 12, padding: 16, border: '1px solid var(--border-primary)', borderRadius: 10, background: 'var(--bg-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <strong>{uploadResult.file_name}</strong>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>({uploadResult.channel}, {uploadResult.total_rows} рядків)</span>
            <button onClick={() => setUploadResult(null)} style={{ marginLeft: 'auto', ...btn, background: 'transparent' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#22c55e' }}>
              <CheckCircle2 size={14} /> <b>{uploadResult.applied}</b> matched
            </span>
            {(uploadResult as UploadResultExtended).orphans_created != null && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a855f7' }}>
                <AlertCircle size={14} /> <b>{(uploadResult as UploadResultExtended).orphans_created}</b> orphan (без PMS бронювання)
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#ef4444' }}>
              <XCircle size={14} /> <b>{uploadResult.cancelled}</b> cancelled
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b' }}>
              <AlertCircle size={14} /> <b>{uploadResult.unmatched}</b> unmatched
            </span>
          </div>
          {uploadResult.unmatched > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                Показати unmatched ({uploadResult.unmatched})
              </summary>
              <table style={{ width: '100%', marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th style={th}>Reservation #</th><th style={th}>Гість</th><th style={th}>Заїзд</th><th style={th}>Сума</th><th style={th}>Причина</th></tr>
                </thead>
                <tbody>
                  {uploadResult.outcomes.filter((o) => o.outcome === 'unmatched').map((o, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border-primary)' }}>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{o.external_reservation_id}</td>
                      <td style={td}>{o.guest_name || '—'}</td>
                      <td style={td}>{o.check_in}</td>
                      <td style={td}>{o.amount ? fmtMoney(o.amount, o.currency || '') : '—'}</td>
                      <td style={{ ...td, color: '#f59e0b' }}>{o.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      {/* Upload history */}
      {uploadHistory.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
            Останні завантаження ({uploadHistory.length})
          </summary>
          <table style={{ width: '100%', marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th}>Дата</th><th style={th}>Канал</th><th style={th}>Файл</th><th style={th}>Рядків</th><th style={th}>Matched</th><th style={th}>Unmatched</th></tr>
            </thead>
            <tbody>
              {uploadHistory.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                  <td style={td}>{u.created_at?.substring(0, 16)}</td>
                  <td style={td}>{u.channel}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{u.file_name}</td>
                  <td style={td}>{u.row_count}</td>
                  <td style={{ ...td, color: '#22c55e' }}>{u.applied_count}</td>
                  <td style={{ ...td, color: u.unmatched_count > 0 ? '#f59e0b' : 'var(--text-secondary)' }}>{u.unmatched_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginTop: 24, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={input}>
          <option value="">Усі статуси</option>
          <option value="expected">Очікується</option>
          <option value="in_statement">У виписці</option>
          <option value="paid">Сплачено</option>
          <option value="cancelled">Скасовано</option>
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 400 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-secondary)' }} />
          <input
            type="text"
            placeholder="Гість або external reservation ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...input, paddingLeft: 30, width: '100%' }}
          />
        </div>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13, marginLeft: 'auto' }}>
          Записів: {receivables.length}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showCzkDetails} onChange={(e) => setShowCzkDetails(e.target.checked)} />
          Деталі CZK (інформ.)
        </label>
      </div>

      {/* Receivables table */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : receivables.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-primary)', borderRadius: 10 }}>
          Receivables не знайдено для обраних фільтрів
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={th}>Канал</th>
                <th style={th}>External ID</th>
                <th style={th}>Гість / Юніт</th>
                <th style={th}>Заїзд</th>
                <th style={{ ...th, textAlign: 'right' }} title="Брутто з Hostex (те що очікується)">Hostex</th>
                <th style={{ ...th, textAlign: 'right' }} title="Брутто з виписки платформи (фактичне)">Statement</th>
                <th style={{ ...th, textAlign: 'right', background: 'rgba(99,102,241,0.06)' }} title="РЕАЛЬНА розбіжність: Hostex vs Statement в EUR. Має бути 0 коли все ок.">Δ {receivables[0]?.currency || ''}</th>
                <th style={{ ...th, textAlign: 'right' }}>Комісія</th>
                <th style={{ ...th, textAlign: 'right' }}>Нетто</th>
                {showCzkDetails && (
                  <>
                    <th style={{ ...th, textAlign: 'right', opacity: 0.7 }}>≈ CZK</th>
                    <th style={{ ...th, textAlign: 'right', opacity: 0.7 }}>PMS (CZK)</th>
                    <th style={{ ...th, textAlign: 'right', opacity: 0.7 }} title="FX volatility (не помилка) — різниця курсу між sync і поточним">Δ CZK*</th>
                  </>
                )}
                <th style={th}>Статус</th>
                <th style={th}>Payout</th>
              </tr>
            </thead>
            <tbody>
              {receivables.map((r) => {
                const sLabel = STATUS_LABEL[r.status] || { label: r.status, color: '#6b7280' };
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                    <td style={td}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.clearing_account_color || '#999', marginRight: 6, verticalAlign: 'middle' }} />
                      {r.channel_source}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.external_reservation_id || '—'}</td>
                    <td style={td}>
                      <div>{r.guest_name}{r.is_orphan === 1 && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', background: 'rgba(168,85,247,0.15)', color: '#a855f7', borderRadius: 4, fontWeight: 600 }}>ORPHAN</span>}</div>
                      {r.unit_name && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.unit_name}</div>}
                      {r.is_orphan === 1 && <div style={{ fontSize: 11, color: '#a855f7' }}>Без PMS бронювання</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.check_in} → {r.check_out}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(r.gross_amount, r.currency)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.actual_gross != null ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {r.actual_gross != null ? fmtMoney(r.actual_gross, r.currency) : '—'}
                    </td>
                    <td style={{
                      ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      background: 'rgba(99,102,241,0.04)', fontWeight: 600,
                      color: r.gross_diff_source_currency == null
                        ? 'var(--text-secondary)'
                        : Math.abs(r.gross_diff_source_currency) < 0.01 ? '#22c55e' : '#ef4444',
                    }}>
                      {r.gross_diff_source_currency == null
                        ? '—'
                        : Math.abs(r.gross_diff_source_currency) < 0.01
                          ? '✓'
                          : `${r.gross_diff_source_currency >= 0 ? '+' : ''}${r.gross_diff_source_currency.toFixed(2)}`}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#ef4444' }}>
                      −{fmtMoney(r.actual_commission ?? r.expected_commission, r.currency)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.actual_net != null ? '#22c55e' : 'var(--text-secondary)', fontWeight: 600 }}>
                      {fmtMoney(r.actual_net ?? r.expected_net, r.currency)}
                    </td>
                    {showCzkDetails && (
                      <>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', fontSize: 11, opacity: 0.7 }}>
                          {r.expected_net_czk != null ? fmtMoney(r.expected_net_czk, 'CZK') : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', fontSize: 11, opacity: 0.7 }}>
                          {r.reservation_total_czk != null ? fmtMoney(r.reservation_total_czk, 'CZK') : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--text-secondary)', opacity: 0.7 }}>
                          {r.reservation_vs_receivable_diff_czk != null ? `${r.reservation_vs_receivable_diff_czk >= 0 ? '+' : ''}${fmtMoney(r.reservation_vs_receivable_diff_czk, 'CZK')}` : '—'}
                        </td>
                      </>
                    )}
                    <td style={td}>
                      <span style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 4,
                        background: `${sLabel.color}15`, color: sLabel.color, fontWeight: 600,
                      }}>
                        {sLabel.label}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 11, color: 'var(--text-secondary)' }}>
                      {r.statement_payout_id ? (
                        <div style={{ fontFamily: 'monospace' }}>{r.statement_payout_id.substring(0, 10)}…</div>
                      ) : '—'}
                      {r.statement_payout_date && <div>{r.statement_payout_date}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const backLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: 8,
  background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none',
};
const btn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, fontWeight: 500,
  cursor: 'pointer',
};
const accountCard: React.CSSProperties = {
  display: 'block', textAlign: 'left', padding: 14,
  background: 'var(--bg-secondary)', border: '2px solid var(--border-primary)',
  borderRadius: 10, cursor: 'pointer', color: 'var(--text-primary)',
};
const input: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 6,
  fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 12,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
