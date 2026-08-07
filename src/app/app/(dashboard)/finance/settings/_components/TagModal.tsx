'use client';

import { useT } from '@core/i18n/client';
import { useState } from 'react';
import { X } from 'lucide-react';
import type { Tag } from './TagsTab';

export interface TagFormValues {
  name: string;
  color: string;
  sort_order?: number;
}

interface Props {
  initial?: Tag;
  onClose: () => void;
  onSave: (values: TagFormValues) => Promise<void>;
}

const COLORS = [
  '#6b7280', '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d',
  '#16a34a', '#0891b2', '#0284c7', '#2563eb', '#4f46e5', '#7c3aed',
  '#c026d3', '#db2777', '#e11d48', '#94a3b8',
];

function readableText(bg: string): string {
  const hex = bg.replace('#', '');
  if (hex.length !== 6) return '#000';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000' : '#fff';
}

export default function TagModal({ initial, onClose, onSave }: Props) {
  const t = useT();
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || '#6b7280');
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError(t('Введіть назву')); return; }

    setSaving(true);
    try {
      await onSave({ name: name.trim(), color, sort_order: Number(sortOrder) || 0 });
    } catch (err: any) {
      setError(t(err.message));
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{initial ? t('Редагувати тег') : t('Новий тег')}</h3>
          <button type="button" onClick={onClose} style={closeBtnStyle}><X size={18} /></button>
        </div>

        <Field label={t('Назва')}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            autoFocus
            maxLength={50}
            placeholder={t('Напр. «Терміново», «Одноразове»')}
          />
        </Field>

        <Field label={t('Колір')}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: c,
                  border: color === c ? '3px solid var(--text-primary)' : '1px solid var(--border-primary)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('Попередній вигляд:')}
            <span
              style={{
                display: 'inline-block',
                marginLeft: 8,
                padding: '3px 10px',
                borderRadius: 12,
                background: color,
                color: readableText(color),
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {name || t('Назва тега')}
            </span>
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

        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

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
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--bg-primary)', borderRadius: 12, padding: 24,
  width: '100%', maxWidth: 440, border: '1px solid var(--border-primary)',
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
