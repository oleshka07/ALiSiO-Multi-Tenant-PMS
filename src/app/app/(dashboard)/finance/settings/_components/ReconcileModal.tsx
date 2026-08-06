'use client';

import { useT } from '@core/i18n/client';
import { useState } from 'react';
import { X, Scale } from 'lucide-react';
import type { Account } from './AccountsTab';

interface Props {
  account: Account;
  onClose: () => void;
  onDone: () => void;
}

export default function ReconcileModal({ account, onClose, onDone }: Props) {
  const t = useT();
  const [actual, setActual] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computed = Number(account.balance) || 0;
  const actualNum = typeof actual === 'number' ? actual : Number(actual);
  const delta = actual === '' ? null : +(actualNum - computed).toFixed(2);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (actual === '' || !isFinite(actualNum)) {
      setError(t('Вкажіть фактичний залишок'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/finance/accounts/${account.id}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual_balance: actualNum, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не вдалося створити коригування');

      if (data.adjustment_operation_id) {
        alert(`Коригування створено.\nДельта: ${data.delta.toFixed(2)} ${account.currency}`);
      } else {
        alert(t('Залишки вже збігаються — коригування не потрібне.'));
      }
      onDone();
    } catch (err: any) {
      setError(t(err.message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 8 }}>
          <Scale size={20} />
          <h3 style={{ margin: 0, flex: 1 }}>{t('Звірка залишку')}</h3>
          <button type="button" onClick={onClose} style={closeBtnStyle}><X size={18} /></button>
        </div>

        <div
          style={{
            background: 'var(--bg-secondary)',
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{t('Рахунок')}</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{account.name}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{t('Обчислений залишок')}</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            {computed.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {account.currency}
          </div>
        </div>

        <Field label={t('Фактичний залишок (скільки реально на рахунку)')}>
          <input
            type="number"
            step="0.01"
            value={actual}
            onChange={(e) => setActual(e.target.value === '' ? '' : Number(e.target.value))}
            style={inputStyle}
            autoFocus
          />
        </Field>

        {delta !== null && Math.abs(delta) >= 0.005 && (
          <div
            style={{
              padding: 10,
              background: delta > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)',
              color: delta > 0 ? '#16a34a' : '#dc2626',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {t('Буде створено коригуючу операцію на')} {delta > 0 ? '+' : ''}{delta.toFixed(2)} {account.currency}
            {' '}({delta > 0 ? 'додаткове надходження' : 'додаткові витрати'})
          </div>
        )}

        <Field label={t('Коментар (опц.)')}>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`Звірка залишків (${account.name})`}
            style={inputStyle}
          />
        </Field>

        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btnSecondaryStyle}>{t('Відміна')}</button>
          <button type="submit" disabled={submitting} style={btnPrimaryStyle}>
            {submitting ? 'Створення…' : 'Створити коригування'}
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
