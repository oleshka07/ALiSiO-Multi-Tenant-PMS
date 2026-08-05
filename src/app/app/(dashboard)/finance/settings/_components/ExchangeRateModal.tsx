'use client';

import { useT } from '@core/i18n/client';
import { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import type { ExchangeRate } from './ExchangeRatesTab';

export interface ExchangeRateFormValues {
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_from: string;
}

interface Props {
  initial?: ExchangeRate;
  onClose: () => void;
  onSave: (values: ExchangeRateFormValues) => Promise<void>;
}

const CURRENCIES = ['CZK', 'EUR', 'USD', 'UAH', 'PLN', 'GBP'];

function todayIso() {
  return new Date().toISOString().substring(0, 10);
}

export default function ExchangeRateModal({ initial, onClose, onSave }: Props) {
  const t = useT();
  const [fromCur, setFromCur] = useState(initial?.from_currency || 'EUR');
  const [toCur, setToCur] = useState(initial?.to_currency || 'CZK');
  const [rate, setRate] = useState<number | ''>(initial?.rate ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effective_from || todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (fromCur === toCur) {
      setError('Валюти «з» і «на» мають відрізнятися');
      return;
    }
    const r = Number(rate);
    if (!isFinite(r) || r <= 0) {
      setError('Курс має бути додатнім числом');
      return;
    }
    setSaving(true);
    try {
      await onSave({ from_currency: fromCur, to_currency: toCur, rate: r, effective_from: effectiveFrom });
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{initial ? 'Редагувати курс' : 'Новий курс валют'}</h3>
          <button type="button" onClick={onClose} style={closeBtnStyle}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end' }}>
          <Field label={t('З')}>
            <select value={fromCur} onChange={(e) => setFromCur(e.target.value)} style={inputStyle}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <div style={{ paddingBottom: 10, color: 'var(--text-secondary)' }}>
            <ArrowRight size={18} />
          </div>
          <Field label={t('На')}>
            <select value={toCur} onChange={(e) => setToCur(e.target.value)} style={inputStyle}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <Field label={`Курс (1 ${fromCur} = ? ${toCur})`}>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={rate}
            onChange={(e) => setRate(e.target.value === '' ? '' : Number(e.target.value))}
            style={inputStyle}
            autoFocus
          />
        </Field>

        <Field label={t('Діє з')}>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            style={inputStyle}
          />
        </Field>

        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={onClose} style={btnSecondaryStyle}>{t('Відміна')}</button>
          <button type="submit" disabled={saving} style={btnPrimaryStyle}>
            {saving ? 'Збереження…' : (initial ? 'Зберегти' : 'Додати')}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--bg-primary)', borderRadius: 12, padding: 24,
  width: '100%', maxWidth: 460, border: '1px solid var(--border-primary)',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border-primary)',
  borderRadius: 8, fontSize: 14, background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const closeBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4,
};
const btnPrimaryStyle: React.CSSProperties = {
  padding: '9px 18px', background: 'var(--accent, #6366f1)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
};
const btnSecondaryStyle: React.CSSProperties = {
  padding: '9px 18px', background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border-primary)', borderRadius: 8, cursor: 'pointer',
};
