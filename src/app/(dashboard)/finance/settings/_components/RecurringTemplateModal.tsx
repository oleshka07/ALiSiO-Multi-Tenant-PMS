'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { RecurringTemplate } from './RecurringTemplatesTab';

export interface TemplateFormValues {
  name: string;
  op_type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  account_from_id?: string | null;
  account_to_id?: string | null;
  category_id?: string | null;
  project_id?: string | null;
  counterparty_id?: string | null;
  comment?: string | null;
  schedule: 'daily' | 'weekly' | 'monthly' | 'yearly';
  schedule_day?: number | null;
  next_run_at: string;
  end_at?: string | null;
  is_active?: boolean;
}

interface Props {
  initial?: RecurringTemplate;
  onClose: () => void;
  onSave: (v: TemplateFormValues) => Promise<void>;
}

export default function RecurringTemplateModal({ initial, onClose, onSave }: Props) {
  const [name, setName] = useState(initial?.name || '');
  const [opType, setOpType] = useState<TemplateFormValues['op_type']>(initial?.op_type || 'expense');
  const [amount, setAmount] = useState(initial?.amount?.toString() || '');
  const [currency, setCurrency] = useState(initial?.currency || 'CZK');
  const [accountFromId, setAccountFromId] = useState(initial?.account_from_id || '');
  const [accountToId, setAccountToId] = useState(initial?.account_to_id || '');
  const [categoryId, setCategoryId] = useState(initial?.category_id || '');
  const [projectId, setProjectId] = useState(initial?.project_id || '');
  const [counterpartyId, setCounterpartyId] = useState(initial?.counterparty_id || '');
  const [comment, setComment] = useState(initial?.comment || '');
  const [schedule, setSchedule] = useState<TemplateFormValues['schedule']>(initial?.schedule || 'monthly');
  const [scheduleDay, setScheduleDay] = useState<number | ''>(initial?.schedule_day ?? '');
  const [nextRunAt, setNextRunAt] = useState(initial?.next_run_at || new Date().toISOString().substring(0, 10));
  const [endAt, setEndAt] = useState(initial?.end_at || '');
  const [isActive, setIsActive] = useState(initial ? !!initial.is_active : true);

  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [counterparties, setCounterparties] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/finance/accounts').then((r) => r.json()).catch(() => []),
      fetch(`/api/finance/categories?op_type=${opType}`).then((r) => r.json()).catch(() => []),
      fetch('/api/finance/projects').then((r) => r.json()).catch(() => []),
      fetch('/api/finance/counterparties').then((r) => r.json()).catch(() => []),
    ]).then(([accs, cats, pjs, cps]) => {
      setAccounts(Array.isArray(accs) ? accs : []);
      setCategories(Array.isArray(cats) ? cats : []);
      setProjects(Array.isArray(pjs) ? pjs : []);
      setCounterparties(Array.isArray(cps) ? cps : []);
    });
  }, [opType]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(amount);
    if (!name.trim()) { setError('Введіть назву'); return; }
    if (!isFinite(amt) || amt <= 0) { setError('Сума має бути додатною'); return; }
    if (opType === 'income' && !accountToId) { setError('Оберіть рахунок-отримувач'); return; }
    if (opType === 'expense' && !accountFromId) { setError('Оберіть рахунок-джерело'); return; }
    if (opType === 'transfer' && (!accountFromId || !accountToId || accountFromId === accountToId)) {
      setError('Оберіть два різні рахунки для переказу');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(), op_type: opType, amount: amt, currency,
        account_from_id: opType === 'income' ? null : accountFromId || null,
        account_to_id: opType === 'expense' ? null : accountToId || null,
        category_id: opType === 'transfer' ? null : categoryId || null,
        project_id: projectId || null,
        counterparty_id: counterpartyId || null,
        comment: comment || null,
        schedule,
        schedule_day: schedule === 'monthly' || schedule === 'weekly' ? (scheduleDay === '' ? null : Number(scheduleDay)) : null,
        next_run_at: nextRunAt,
        end_at: endAt || null,
        is_active: isActive,
      });
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{initial ? 'Редагувати шаблон' : 'Новий регулярний шаблон'}</h3>
          <button type="button" onClick={onClose} style={closeBtn}><X size={18} /></button>
        </div>

        <Field label="Назва">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={input} autoFocus placeholder="Напр. Оренда кемпінгу" />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 8 }}>
          <Field label="Тип">
            <select value={opType} onChange={(e) => setOpType(e.target.value as any)} style={input}>
              <option value="income">Дохід</option>
              <option value="expense">Витрата</option>
              <option value="transfer">Переказ</option>
            </select>
          </Field>
          <Field label="Сума">
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} />
          </Field>
          <Field label="Валюта">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={input}>
              <option value="CZK">CZK</option><option value="EUR">EUR</option><option value="USD">USD</option>
            </select>
          </Field>
        </div>

        {(opType === 'expense' || opType === 'transfer') && (
          <Field label={opType === 'transfer' ? 'З рахунку' : 'З рахунку (витрата)'}>
            <select value={accountFromId} onChange={(e) => setAccountFromId(e.target.value)} style={input}>
              <option value="">—</option>
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </Field>
        )}
        {(opType === 'income' || opType === 'transfer') && (
          <Field label={opType === 'transfer' ? 'На рахунок' : 'На рахунок (дохід)'}>
            <select value={accountToId} onChange={(e) => setAccountToId(e.target.value)} style={input}>
              <option value="">—</option>
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </Field>
        )}

        {opType !== 'transfer' && (
          <Field label="Категорія (опц.)">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={input}>
              <option value="">—</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.icon || ''} {c.name}</option>)}
            </select>
          </Field>
        )}

        {opType !== 'transfer' && (
          <Field label="Контрагент (опц.)">
            <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} style={input}>
              <option value="">—</option>
              {counterparties.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Проєкт (опц.)">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={input}>
            <option value="">—</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Розклад">
            <select value={schedule} onChange={(e) => setSchedule(e.target.value as any)} style={input}>
              <option value="daily">Щодня</option>
              <option value="weekly">Щотижня</option>
              <option value="monthly">Щомісяця</option>
              <option value="yearly">Щороку</option>
            </select>
          </Field>
          {(schedule === 'monthly' || schedule === 'weekly') && (
            <Field label={schedule === 'monthly' ? 'День місяця' : 'День тижня (0=Пн, 6=Нд)'}>
              <input type="number" min={schedule === 'monthly' ? 1 : 0} max={schedule === 'monthly' ? 31 : 6}
                value={scheduleDay} onChange={(e) => setScheduleDay(e.target.value === '' ? '' : Number(e.target.value))} style={input} />
            </Field>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Наступний запуск">
            <input type="date" value={nextRunAt} onChange={(e) => setNextRunAt(e.target.value)} style={input} />
          </Field>
          <Field label="Закінчити (опц.)">
            <input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={input} />
          </Field>
        </div>

        <Field label="Коментар (опц.)">
          <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} style={input} />
        </Field>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Активний
        </label>

        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btnSec}>Відміна</button>
          <button type="submit" disabled={saving} style={btnPrim}>{saving ? 'Збереження…' : initial ? 'Зберегти' : 'Створити'}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
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
const input: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border-primary)',
  borderRadius: 8, fontSize: 14, background: 'var(--bg-primary)', color: 'var(--text-primary)',
};
const closeBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 };
const btnPrim: React.CSSProperties = { padding: '9px 18px', background: 'var(--accent, #6366f1)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const btnSec: React.CSSProperties = { padding: '9px 18px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)', borderRadius: 8, cursor: 'pointer' };
