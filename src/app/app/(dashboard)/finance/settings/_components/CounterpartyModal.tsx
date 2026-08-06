'use client';

import { useT } from '@core/i18n/client';
import { useEffect, useState } from 'react';
import { X, Plus as PlusIcon } from 'lucide-react';
import type { Counterparty, CounterpartyNode, Kind } from './CounterpartiesTab';

export interface CounterpartyFormValues {
  name: string;
  kind?: Kind | null;
  aliases?: string[];
  icon?: string;
  color?: string;
  note?: string;
  sort_order?: number;
  parent_id?: string | null;
}

interface Props {
  initial?: Counterparty;
  parent: CounterpartyNode | Counterparty | null;
  onClose: () => void;
  onSave: (values: CounterpartyFormValues) => Promise<void>;
}

const KIND_OPTIONS: { value: Kind | ''; label: string }[] = [
  { value: '',         label: 'Не вказано' },
  { value: 'client',   label: 'Клієнт' },
  { value: 'supplier', label: 'Постачальник' },
  { value: 'employee', label: 'Співробітник' },
  { value: 'other',    label: 'Інше' },
];

const COLORS = ['#6b7280', '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#0ea5e9', '#059669'];
const ICONS = ['', '🤝', '🏪', '👷', '📋', '💼', '🏢', '✈️', '📦', '🛒', '🏦', '💳', '💰', '🎯'];

interface Suggestion { text: string; count: number }

export default function CounterpartyModal({ initial, parent, onClose, onSave }: Props) {
  const t = useT();
  const isSubcounterparty = !!parent;
  const isEditingSub = initial && initial.parent_id !== null;
  const kindDisabled = isSubcounterparty || isEditingSub;

  const [name, setName] = useState(initial?.name || '');
  const [kind, setKind] = useState<Kind | ''>((initial?.kind || parent?.kind || '') as Kind | '');
  const [aliases, setAliases] = useState<string[]>(initial?.aliases || []);
  const [aliasInput, setAliasInput] = useState('');
  const [icon, setIcon] = useState(initial?.icon || '');
  const [color, setColor] = useState(initial?.color || '#6b7280');
  const [note, setNote] = useState(initial?.note || '');
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    fetch('/api/finance/counterparties/suggestions')
      .then((r) => r.json())
      .then((j) => setSuggestions(j.suggestions || []))
      .catch(() => { /* optional */ });
  }, []);

  function addAlias(raw: string) {
    const v = raw.trim().toUpperCase();
    if (!v) return;
    if (aliases.includes(v)) return;
    setAliases([...aliases, v]);
    setAliasInput('');
  }

  function removeAlias(a: string) {
    setAliases(aliases.filter((x) => x !== a));
  }

  function handleAliasKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addAlias(aliasInput);
    } else if (e.key === 'Backspace' && !aliasInput && aliases.length > 0) {
      setAliases(aliases.slice(0, -1));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError(t('Введіть назву')); return; }

    // Ensure any pending alias input is captured
    const pendingAlias = aliasInput.trim().toUpperCase();
    const finalAliases = pendingAlias && !aliases.includes(pendingAlias)
      ? [...aliases, pendingAlias]
      : aliases;

    setSaving(true);
    try {
      const values: CounterpartyFormValues = {
        name: name.trim(),
        aliases: finalAliases,
        icon: icon || undefined,
        color,
        note: note.trim() || undefined,
        sort_order: Number(sortOrder) || 0,
      };
      if (!initial) {
        values.parent_id = parent ? parent.id : null;
        if (!parent) values.kind = kind || null;
      } else if (!isEditingSub) {
        values.kind = kind || null;
      }
      await onSave(values);
    } catch (err: any) {
      setError(t(err.message));
      setSaving(false);
    }
  }

  const visibleSuggestions = suggestions.filter(
    (s) => !aliases.includes(s.text)
  ).slice(0, 5);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>
            {initial
              ? (isEditingSub ? 'Редагувати підконтрагента' : 'Редагувати контрагента')
              : (parent ? `Новий підконтрагент у «${parent.name}»` : 'Новий контрагент')}
          </h3>
          <button type="button" onClick={onClose} style={closeBtnStyle}><X size={18} /></button>
        </div>

        <Field label={t('Назва')}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
        </Field>

        <Field label={t('Тип')}>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind | '')}
            style={inputStyle}
            disabled={kindDisabled}
          >
            {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {kindDisabled && <div style={hintStyle}>{t('Успадковано від батька')}</div>}
        </Field>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {t('Синоніми (для автоматчингу з банк-коментарів)')}
          </label>
          <div style={chipContainerStyle}>
            {aliases.map((a) => (
              <span key={a} style={chipStyle}>
                {a}
                <button type="button" onClick={() => removeAlias(a)} style={chipXBtn} aria-label={t('Видалити')}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={handleAliasKeyDown}
              onBlur={() => aliasInput.trim() && addAlias(aliasInput)}
              placeholder={aliases.length === 0 ? 'Напр. FACEBK, META, FACEBOOK (Enter щоб додати)' : 'Додати ще...'}
              style={chipInputStyle}
            />
          </div>
          <div style={hintStyle}>
            {t('Синоніми автоматично переводяться у ВЕРХНІЙ регістр. Пошук case-insensitive підрядком.')}
          </div>

          {visibleSuggestions.length > 0 && (
            <div style={suggestionsBoxStyle}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {t('Пропозиції з існуючих операцій:')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {visibleSuggestions.map((s) => (
                  <button
                    key={s.text}
                    type="button"
                    onClick={() => addAlias(s.text)}
                    style={suggestionChipStyle}
                    title={`Використовується в ${s.count} операціях`}
                  >
                    <PlusIcon size={11} /> {s.text}
                    <span style={{ opacity: 0.6, fontSize: 10 }}>×{s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={t('Іконка')}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ICONS.map((i) => (
                <button
                  key={i || 'none'}
                  type="button"
                  onClick={() => setIcon(i)}
                  style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: icon === i ? 'var(--accent, #6366f1)' : 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    cursor: 'pointer', fontSize: 18,
                    color: i ? undefined : 'var(--text-secondary)',
                  }}
                  title={i ? i : 'Без іконки'}
                >
                  {i || '∅'}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('Колір')}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: c,
                    border: color === c ? '3px solid var(--text-primary)' : '1px solid var(--border-primary)',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </Field>
        </div>

        <Field label={t('Нотатка (опц.)')}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
            placeholder={t('Додаткова інформація: адреса, телефон, умови співпраці...')}
          />
        </Field>

        <Field label={t('Порядок сортування')}>
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} style={inputStyle} />
        </Field>

        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={onClose} style={btnSecondaryStyle}>{t('Відміна')}</button>
          <button type="submit" disabled={saving} style={btnPrimaryStyle}>
            {saving ? 'Збереження…' : (initial ? 'Зберегти' : 'Створити')}
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
  width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto',
  border: '1px solid var(--border-primary)',
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
const hintStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-secondary)', marginTop: 4,
};
const chipContainerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
  padding: '6px 8px', border: '1px solid var(--border-primary)',
  borderRadius: 8, background: 'var(--bg-primary)', minHeight: 42,
};
const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 8px', background: 'var(--bg-secondary)',
  borderRadius: 4, fontSize: 12, fontFamily: 'monospace',
};
const chipXBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  display: 'inline-flex', color: 'var(--text-secondary)', padding: 0,
};
const chipInputStyle: React.CSSProperties = {
  flex: 1, minWidth: 120, border: 'none', outline: 'none',
  background: 'transparent', color: 'var(--text-primary)', fontSize: 14,
};
const suggestionsBoxStyle: React.CSSProperties = {
  marginTop: 10, padding: 10,
  background: 'var(--bg-secondary)', borderRadius: 8,
  border: '1px dashed var(--border-primary)',
};
const suggestionChipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 8px', border: '1px solid var(--border-primary)',
  borderRadius: 4, background: 'var(--bg-primary)', cursor: 'pointer',
  fontSize: 11, fontFamily: 'monospace', color: 'var(--text-primary)',
};
