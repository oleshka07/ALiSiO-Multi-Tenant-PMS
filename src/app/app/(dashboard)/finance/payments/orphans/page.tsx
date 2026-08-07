'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';

interface OrphanRow {
  source_table: 'booking_service_orders' | 'service_orders';
  order_id: string;
  reservation_id: string | null;
  service_id: string;
  service_name: string | null;
  total_price: number;
  payment_id: string | null;
  payment_status: string;
  created_at: string;
  guest_name: string | null;
  unit_name: string | null;
}

export default function OrphanPaymentsPage() {
  const t = useT();
  const [rows, setRows] = useState<OrphanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/payment-orphans');
      const json = await res.json();
      setRows(json.orphans || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  async function handleRestore(row: OrphanRow) {
    if (!row.reservation_id) return;
    if (!confirm(
      `Створити fin_operation на ${row.total_price} CZK для гостя «${row.guest_name || '—'}»?\n` +
      `Послуга: ${row.service_name || row.service_id}`,
    )) return;
    setRestoring(row.order_id);
    try {
      const res = await fetch('/api/finance/payment-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_table: row.source_table,
          order_id: row.order_id,
          paid_at: row.created_at,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`Помилка: ${json.error || 'restore failed'}`);
      } else if (json.ok) {
        setDone((d) => ({ ...d, [row.order_id]: json.operation_id }));
      } else {
        alert(`Не вдалось: ${json.message || json.reason}`);
      }
    } catch (e: any) { alert(`Помилка: ${t(e.message)}`); }
    setRestoring(null);
  }

  const total = rows.reduce((s, r) => s + (r.total_price || 0), 0);

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/app/finance" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={24} color="#f59e0b" /> Orphan Payments
        </h1>
        <button onClick={fetchRows} disabled={loading} style={{ ...btn, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} /> {t('Оновити')}
        </button>
      </div>

      <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
        {t('Замовлення зі статусом')} <code>paid</code>{t(', але без відповідного запису у fin_operations. Зазвичай це симптом збою Teya webhook\'а (sessionId vs transactionId, падіння в обробнику тощо). Натисни «Створити fin_operation» — це додасть платіж у фінансову систему ретроспективно.')}
      </p>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('Завантаження…')}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-primary)', borderRadius: 10, marginTop: 16 }}>
          {t('✓ Orphan-платежів не знайдено')}
        </div>
      ) : (
        <>
          <div style={{ marginTop: 16, marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('Знайдено:')} <b>{rows.length}</b> {t('· Загальна сума:')} <b>{total.toLocaleString('cs-CZ', { minimumFractionDigits: 2 })} CZK</b>
          </div>
          <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={th}>{t('Дата')}</th>
                  <th style={th}>{t('Гість / Юніт')}</th>
                  <th style={th}>{t('Послуга')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('Сума')}</th>
                  <th style={th}>Payment ID</th>
                  <th style={th}>{t('Джерело')}</th>
                  <th style={th}>{t('Дія')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const recovered = done[r.order_id];
                  return (
                    <tr key={r.order_id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                      <td style={td}>{r.created_at?.substring(0, 16)}</td>
                      <td style={td}>
                        <div>{r.guest_name || '—'}</div>
                        {r.unit_name && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.unit_name}</div>}
                      </td>
                      <td style={td}>{r.service_name || <code>{r.service_id}</code>}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {r.total_price?.toLocaleString('cs-CZ', { minimumFractionDigits: 2 })} CZK
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
                        {r.payment_id ? r.payment_id.substring(0, 14) + '…' : '—'}
                      </td>
                      <td style={{ ...td, fontSize: 11, color: 'var(--text-secondary)' }}>
                        {r.source_table === 'booking_service_orders' ? 'Widget (booking)' : 'Guest page'}
                      </td>
                      <td style={td}>
                        {recovered ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#22c55e', fontSize: 12, fontWeight: 600 }}>
                            <CheckCircle2 size={14} /> {t('Створено')}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleRestore(r)}
                            disabled={restoring === r.order_id || !r.reservation_id}
                            style={{ ...btn, background: '#16a34a', color: 'white', borderColor: '#16a34a' }}
                          >
                            {restoring === r.order_id ? t('Створення…') : t('Створити fin_operation')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, fontWeight: 500,
  cursor: 'pointer',
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 12,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
