'use client';

import { useT } from '@core/i18n/client';
import { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown } from 'lucide-react';

interface Props { onClose: () => void }

interface Indicators {
  month: string;
  revenue: number;
  cogs: number;
  variable: number;
  operational: number;
  gross_profit: number;
  marginal_income: number;
  ebitda: number;
  margin_pct: number | null;
  gross_margin_pct: number | null;
}

function formatCZK(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(Math.round(n)).toLocaleString('cs-CZ')} CZK`;
}

export default function IndicatorsModal({ onClose }: Props) {
  const t = useT();
  const [month, setMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [data, setData] = useState<Indicators | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/finance/indicators?month=${month}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{t('📈 Фінансові показники')}</h3>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={input} />
          <button type="button" onClick={onClose} style={closeBtn}><X size={18} /></button>
        </div>

        {loading || !data ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('Завантаження…')}</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <KpiCard label={t('Виручка')} value={formatCZK(data.revenue)} color="#22c55e" />
              <KpiCard label="EBITDA" value={formatCZK(data.ebitda)} color={data.ebitda >= 0 ? '#22c55e' : '#ef4444'} subvalue={data.margin_pct !== null ? `${data.margin_pct}% маржа` : undefined} />
              <KpiCard label={t('Валовий прибуток')} value={formatCZK(data.gross_profit)} subvalue={data.gross_margin_pct !== null ? `${data.gross_margin_pct}% GP margin` : undefined} />
              <KpiCard label={t('Маржинальний дохід')} value={formatCZK(data.marginal_income)} />
            </div>

            <div style={{ marginTop: 16, padding: 14, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>{t('Формули')}</div>
              <Formula label={t('Валовий прибуток')} formula="Виручка − COGS" result={formatCZK(data.gross_profit)} details={`${formatCZK(data.revenue)} − ${formatCZK(data.cogs)}`} />
              <Formula label={t('Маржинальний дохід')} formula="Валовий прибуток − Змінні" result={formatCZK(data.marginal_income)} details={`${formatCZK(data.gross_profit)} − ${formatCZK(data.variable)}`} />
              <Formula label="EBITDA" formula="Маржинальний дохід − Операційні" result={formatCZK(data.ebitda)} details={`${formatCZK(data.marginal_income)} − ${formatCZK(data.operational)}`} />
              {data.margin_pct !== null && (
                <Formula label={t('Маржа (EBITDA %)')} formula="(EBITDA ÷ Виручка) × 100" result={`${data.margin_pct}%`} details="" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, subvalue, color }: { label: string; value: string; subvalue?: string; color?: string }) {
  return (
    <div style={{ padding: 14, background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border-primary)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: color || 'var(--text-primary)' }}>{value}</div>
      {subvalue && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{subvalue}</div>}
    </div>
  );
}

function Formula({ label, formula, result, details }: { label: string; formula: string; result: string; details: string }) {
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border-primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{result}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        {formula}{details && ` = ${details}`}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--bg-primary)', borderRadius: 12, padding: 24,
  width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto',
  border: '1px solid var(--border-primary)',
};
const input: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border-primary)',
  borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const closeBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 };
