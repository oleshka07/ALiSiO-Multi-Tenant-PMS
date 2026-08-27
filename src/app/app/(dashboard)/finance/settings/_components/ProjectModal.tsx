'use client';

import { useT } from '@core/i18n/client';
import { useState } from 'react';
import { X } from 'lucide-react';
import type { Project, ProjectNode } from './ProjectsTab';

export interface ProjectFormValues {
  name: string;
  unit_type?: string;
  is_shared?: number;
  sort_order?: number;
  parent_id?: string | null;
}

interface Props {
  initial?: Project;
  parent: ProjectNode | Project | null;
  onClose: () => void;
  onSave: (values: ProjectFormValues) => Promise<void>;
}

export default function ProjectModal({ initial, parent, onClose, onSave }: Props) {
  const t = useT();
  const isSubproject = !!parent;
  const inheritedShared = parent?.is_shared === 1;
  const isEditingSubproject = initial && initial.parent_id !== null;
  const sharedDisabled = isSubproject || isEditingSubproject;

  const [name, setName] = useState(initial?.name || '');
  const [unitType, setUnitType] = useState(initial?.unit_type || '');
  const [isShared, setIsShared] = useState<boolean>(
    initial?.is_shared === 1 || (isSubproject && inheritedShared)
  );
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError(t('Введіть назву')); return; }
    setSaving(true);
    try {
      const values: ProjectFormValues = {
        name: name.trim(),
        unit_type: unitType.trim() || undefined,
        sort_order: Number(sortOrder) || 0,
      };
      if (!initial) {
        values.parent_id = parent ? parent.id : null;
        if (!parent) values.is_shared = isShared ? 1 : 0;
      } else if (!isEditingSubproject) {
        values.is_shared = isShared ? 1 : 0;
      }
      await onSave(values);
    } catch (err: any) {
      setError(t(err.message));
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>
            {initial
              ? (isEditingSubproject ? t('Редагувати підпроєкт') : t('Редагувати проєкт'))
              : (parent ? `${t('Новий підпроєкт у «')}${parent.name}»` : t('Новий проєкт'))}
          </h3>
          <button type="button" onClick={onClose} style={closeBtnStyle}><X size={18} /></button>
        </div>

        <Field label={t('Назва')}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            autoFocus
          />
        </Field>

        <Field label={t('Опис (опц.)')}>
          <input
            type="text"
            value={unitType}
            onChange={(e) => setUnitType(e.target.value)}
            placeholder={t('Напр. «Міні-готель / 16 номерів»')}
            style={inputStyle}
          />
        </Field>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: sharedDisabled ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              disabled={sharedDisabled}
            />
            <span style={{ fontSize: 14 }}>{t('Це спільний проєкт (розподіляється на усі)')}</span>
          </label>
          <div style={hintStyle}>
            {sharedDisabled
              ? t('Успадковано від батьківського проєкту')
              : t('Наприклад, HQ/Загальне — витрати такого проєкту стосуються всіх')}
          </div>
        </div>

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
  width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
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
  fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, marginLeft: 26,
};
