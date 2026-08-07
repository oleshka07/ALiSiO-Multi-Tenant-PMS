'use client';

import { useT } from '@core/i18n/client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Account } from './AccountsTab';

export interface AccountFormValues {
  name: string;
  type: Account['type'];
  currency: string;
  initial_balance: number;
  credit_limit: number | null;
  iban: string | null;
  color: string;
  sort_order: number;
}

interface Props {
  initial?: Account;
  onClose: () => void;
  onSave: (values: AccountFormValues) => Promise<void>;
}

const TYPE_OPTIONS: { value: Account['type']; label: string }[] = [
  { value: 'cash', label: 'Готівка' },
  { value: 'bank', label: 'Банківський рахунок' },
  { value: 'card', label: 'Кредитна картка' },
  { value: 'investment', label: 'Інвестиції' },
  { value: 'other', label: 'Інше' },
];

const CURRENCIES = ['CZK', 'EUR', 'USD', 'UAH', 'PLN', 'GBP'];
const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#0ea5e9', '#64748b'];

export default function AccountModal({ initial, onClose, onSave }: Props) {
  const t = useT();
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState<Account['type']>(initial?.type || 'cash');
  const [currency, setCurrency] = useState(initial?.currency || 'CZK');
  const [initialBalance, setInitialBalance] = useState(initial?.initial_balance ?? 0);
  const [creditLimit, setCreditLimit] = useState<number | ''>(initial?.credit_limit ?? '');
  const [iban, setIban] = useState((initial as any)?.iban || '');
  const [color, setColor] = useState(initial?.color || '#6366f1');
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (type !== 'card') setCreditLimit('');
  }, [type]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('Введіть назву'));
      return;
    }
    if (type === 'card' && (creditLimit === '' || Number(creditLimit) < 0)) {
      setError(t('Для кредитної картки вкажіть ліміт ≥ 0'));
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        type,
        currency,
        initial_balance: Number(initialBalance) || 0,
        credit_limit: type === 'card' ? Number(creditLimit) : null,
        iban: iban.trim() ? iban.trim().replace(/[\s\-/]/g, '').toUpperCase() : null,
        color,
        sort_order: Number(sortOrder) || 0,
      });
    } catch (err: any) {
      setError(t(err.message));
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={modalStyle}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{initial ? t('Редагувати рахунок') : t('Новий рахунок')}</h3>
          <button type="button" onClick={onClose} style={closeBtnStyle}><X size={18} /></button>
        </div>

        <Field label={t('Назва')}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={t('Тип')}>
            <select value={type} onChange={(e) => setType(e.target.value as Account['type'])} style={inputStyle}>
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
            </select>
          </Field>
          <Field label={t('Валюта')}>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inputStyle}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <Field label={t('Стартовий залишок')}>
          <input
            type="number"
            step="0.01"
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
            style={inputStyle}
          />
        </Field>

        {type === 'card' && (
          <Field label={t('Кредитний ліміт')}>
            <input
              type="number"
              step="0.01"
              min="0"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value === '' ? '' : Number(e.target.value))}
              style={inputStyle}
              placeholder={t('Напр. 50000')}
            />
          </Field>
        )}

        {(type === 'bank' || type === 'card') && (
          <Field label={t('IBAN (для авто-роутингу банк-виписок)')}>
            <input
              type="text"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              style={inputStyle}
              placeholder="CZ12 0100 0000 0123 4567 8901"
              autoComplete="off"
            />
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              {t('IBAN використовується щоб автоматично прив\'язувати XML-виписки KB до цього рахунку. Можна писати з пробілами — нормалізується автоматично.')}
            </div>
          </Field>
        )}

        <Field label={t('Колір')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: c,
                  border: color === c ? '3px solid var(--text-primary)' : '1px solid var(--border-primary)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </Field>

        <Field label={t('Порядок сортування')}>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            style={inputStyle}
          />
        </Field>

        {error && (
          <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={onClose} style={btnSecondaryStyle}>{t('Відміна')}</button>
          <button type="submit" disabled={saving} style={btnPrimaryStyle}>
            {saving ? t('Збереження…') : (initial ? t('Зберегти') : t('Створити'))}
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
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const modalStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  borderRadius: 12,
  padding: 24,
  width: '100%',
  maxWidth: 480,
  maxHeight: '90vh',
  overflowY: 'auto',
  border: '1px solid var(--border-primary)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  fontSize: 14,
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  padding: 4,
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: '9px 18px',
  background: 'var(--accent, #6366f1)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
};

const btnSecondaryStyle: React.CSSProperties = {
  padding: '9px 18px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  cursor: 'pointer',
};
