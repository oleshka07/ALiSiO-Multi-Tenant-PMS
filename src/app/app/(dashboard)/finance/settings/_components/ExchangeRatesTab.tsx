'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ArrowRight } from 'lucide-react';
import ExchangeRateModal, { ExchangeRateFormValues } from './ExchangeRateModal';

export interface ExchangeRate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_from: string;
  created_at: string;
}

interface RatesResponse {
  rates: ExchangeRate[];
  latest: { from_currency: string; to_currency: string; rate: number; effective_from: string }[];
}

export default function ExchangeRatesTab() {
  const t = useT();
  const [data, setData] = useState<RatesResponse>({ rates: [], latest: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExchangeRate | 'new' | null>(null);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/exchange-rates');
      const json = await res.json();
      setData(json?.rates ? json : { rates: [], latest: [] });
    } catch (e) {
      console.error('Failed to load exchange rates', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRates(); }, [fetchRates]);

  async function handleSave(values: ExchangeRateFormValues) {
    const isEdit = editing !== 'new' && editing !== null;
    const payload = isEdit ? { id: (editing as ExchangeRate).id, ...values } : values;
    const res = await fetch('/api/finance/exchange-rates', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Помилка збереження');
    }
    setEditing(null);
    fetchRates();
  }

  async function handleDelete(rate: ExchangeRate) {
    if (!confirm(`Видалити курс ${rate.from_currency} → ${rate.to_currency} (${rate.effective_from})?`)) return;
    const res = await fetch(`/api/finance/exchange-rates/${rate.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося видалити');
      return;
    }
    fetchRates();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{t('Курси валют')}</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {data.rates.length} {t('запис')}{data.rates.length === 1 ? '' : t('ів')}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setEditing('new')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            background: 'var(--accent, #6366f1)', color: '#fff', border: 'none',
            borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
          }}
        >
          <Plus size={16} /> {t('Додати курс')}
        </button>
      </div>

      {data.latest.length > 0 && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
            {t('Поточні курси (на сьогодні)')}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {data.latest.map((r) => (
              <div
                key={`${r.from_currency}-${r.to_currency}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  background: 'var(--bg-primary)', borderRadius: 8, fontSize: 14,
                }}
              >
                <span style={{ fontWeight: 600 }}>{r.from_currency}</span>
                <ArrowRight size={14} style={{ color: 'var(--text-secondary)' }} />
                <span style={{ fontWeight: 600 }}>{r.to_currency}</span>
                <span style={{ color: 'var(--text-secondary)' }}>=</span>
                <span style={{ fontWeight: 700 }}>{r.rate.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('Завантаження…')}</div>
      ) : data.rates.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: 'var(--text-secondary)',
            border: '1px dashed var(--border-primary)',
            borderRadius: 10,
          }}
        >
          {t('Курсів ще немає. Додайте перший (напр. EUR → CZK = 25.20).')}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={thStyle}>{t('З')}</th>
                <th style={thStyle}>{t('На')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('Курс')}</th>
                <th style={thStyle}>{t('Діє з')}</th>
                <th style={{ ...thStyle, width: 100 }}>{t('Дії')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rates.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                  <td style={tdStyle}><strong>{r.from_currency}</strong></td>
                  <td style={tdStyle}><strong>{r.to_currency}</strong></td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.rate.toFixed(4)}
                  </td>
                  <td style={tdStyle}>{r.effective_from}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <button style={iconBtnStyle} title={t('Редагувати')} onClick={() => setEditing(r)}>
                      <Pencil size={15} />
                    </button>
                    <button
                      style={{ ...iconBtnStyle, color: '#dc2626' }}
                      title={t('Видалити')}
                      onClick={() => handleDelete(r)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ExchangeRateModal
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontWeight: 600, fontSize: 13,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)',
};
const tdStyle: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 6, margin: '0 2px',
  cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: 6,
};
