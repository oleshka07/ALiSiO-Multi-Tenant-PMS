'use client';

import { useT } from '@core/i18n/client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ExternalLink } from 'lucide-react';
import { useHotelCurrency } from '@/ui/hooks/useCurrentUser';

interface Props {
  month: string;
  categoryId: string | null;
  categoryName: string;
  opType?: 'income' | 'expense';
  basis?: 'paid' | 'accrued';
  onClose: () => void;
}

function formatMoney(n: number, currency: string): string {
  return `${n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function DrillDownModal({ month, categoryId, categoryName, opType, basis = 'paid', onClose }: Props) {
  // Підсумок підписується валютою готелю, коли операції ще не завантажились
  // або в них її немає. Крони тут були припущенням про клієнта.
  const hotelCurrency = useHotelCurrency();
  const t = useT();
  const [ops, setOps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ month, basis });
    if (categoryId) params.set('category_id', categoryId);
    else params.set('category_id', '_uncategorized');
    if (opType) params.set('op_type', opType);
    fetch(`/api/finance/operations-drill-down?${params}`)
      .then((r) => r.json())
      .then((d) => setOps(d.operations || []))
      .finally(() => setLoading(false));
  }, [month, categoryId, opType, basis]);

  const total = ops.reduce((s, o) => s + (Number(o.amount) || 0), 0);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{month}</div>
            <h3 style={{ margin: 0 }}>{categoryName}</h3>
          </div>
          <button type="button" onClick={onClose} style={closeBtn}><X size={18} /></button>
        </div>

        <div style={{ padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{t('Операцій:')} {ops.length}</span>
          <span style={{ fontWeight: 700 }}>Σ {formatMoney(total, ops[0]?.currency || hotelCurrency)}</span>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('Завантаження…')}</div>
        ) : ops.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('Операцій не знайдено')}</div>
        ) : (
          <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {ops.map((o) => (
              <div key={o.id} style={rowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {o.category_icon && <span style={{ marginRight: 4 }}>{o.category_icon}</span>}
                    {o.counterparty_name || o.comment?.substring(0, 50) || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {o.paid_at.substring(0, 10)} · {o.account_from_name || o.account_to_name || '—'}{o.project_name ? ` · ${o.project_name}` : ''}
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: o.op_type === 'expense' ? '#ef4444' : '#22c55e' }}>
                  {o.op_type === 'expense' ? '−' : '+'} {formatMoney(o.amount, o.currency)}
                </div>
                <Link href={`/app/finance/operations?search=${encodeURIComponent(o.id)}`} style={{ marginLeft: 10, color: 'var(--text-secondary)' }} title={t('Відкрити')}>
                  <ExternalLink size={14} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--bg-primary)', borderRadius: 12, padding: 20,
  width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto',
  border: '1px solid var(--border-primary)',
};
const closeBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 };
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
  borderBottom: '1px solid var(--border-primary)',
};
