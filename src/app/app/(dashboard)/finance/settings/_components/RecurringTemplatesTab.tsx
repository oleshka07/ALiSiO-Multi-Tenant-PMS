'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Play, RotateCcw, Clock } from 'lucide-react';
import RecurringTemplateModal, { TemplateFormValues } from './RecurringTemplateModal';

export interface RecurringTemplate {
  id: string;
  name: string;
  op_type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  account_from_id: string | null;
  account_to_id: string | null;
  account_from_name: string | null;
  account_to_name: string | null;
  category_id: string | null;
  category_name: string | null;
  project_id: string | null;
  project_name: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  comment: string | null;
  schedule: 'daily' | 'weekly' | 'monthly' | 'yearly';
  schedule_day: number | null;
  next_run_at: string;
  end_at: string | null;
  last_run_at: string | null;
  runs_created: number;
  is_active: number;
  /** Скільки прогонів поспіль відмовили і чим (Р13.7). */
  failed_runs?: number;
  last_error?: string | null;
}

const SCHEDULE_LABELS: Record<string, string> = {
  daily: 'щодня', weekly: 'щотижня', monthly: 'щомісяця', yearly: 'щороку',
};
const OP_TYPE_LABEL: Record<string, string> = {
  income: 'Дохід', expense: 'Витрата', transfer: 'Переказ',
};

function formatAmount(amt: number, currency: string): string {
  return `${amt.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function RecurringTemplatesTab() {
  const tUi = useT();
  const [items, setItems] = useState<RecurringTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RecurringTemplate | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const url = showArchived ? '/api/finance/recurring?archived=1' : '/api/finance/recurring';
      const res = await fetch(url);
      const json = await res.json();
      setItems(Array.isArray(json) ? json : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [showArchived]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function handleSave(values: TemplateFormValues, id?: string) {
    const res = await fetch(id ? `/api/finance/recurring/${id}` : '/api/finance/recurring', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Помилка');
    }
    setEditing(null);
    fetchItems();
  }

  async function handleDelete(t: RecurringTemplate) {
    if (!confirm(`Видалити шаблон «${t.name}»? Створені операції залишаться.`)) return;
    const res = await fetch(`/api/finance/recurring/${t.id}`, { method: 'DELETE' });
    if (!res.ok) { alert(tUi('Не вдалося')); return; }
    fetchItems();
  }

  async function handleToggle(t: RecurringTemplate) {
    await fetch(`/api/finance/recurring/${t.id}/toggle`, { method: 'PATCH' });
    fetchItems();
  }

  async function handleRunNow(t: RecurringTemplate) {
    if (!confirm(`Виконати шаблон «${t.name}» зараз? Створиться операція на ${t.next_run_at}.`)) return;
    const res = await fetch(`/api/finance/recurring/${t.id}/run-now`, { method: 'POST' });
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert(err.error || 'Не вдалося'); return; }
    fetchItems();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{tUi('Регулярки')}</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {items.filter((t) => t.is_active).length} {tUi('активних')}
        </span>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {tUi('Показати вимкнені')}
        </label>
        <button onClick={() => setEditing('new')} style={btnAdd}>
          <Plus size={16} /> {tUi('Додати шаблон')}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{tUi('Завантаження…')}</div>
      ) : items.length === 0 ? (
        <div style={emptyStyle}>
          {tUi('Шаблонів немає. Створіть перший, щоб автоматично генерувати операції кожного періоду (оренда, зарплата, підписки).')}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={th}>{tUi('Назва')}</th>
                <th style={th}>{tUi('Тип')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{tUi('Сума')}</th>
                <th style={th}>{tUi('Розклад')}</th>
                <th style={th}>{tUi('Наступний запуск')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{tUi('Створено')}</th>
                <th style={{ ...th, width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--border-primary)', opacity: t.is_active ? 1 : 0.5 }}>
                  <td style={{ ...td, fontWeight: 500 }}>
                    <Clock size={12} style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--text-secondary)' }} />
                    {t.name}
                    {t.comment && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{t.comment}</div>}
                    {/* Чому шаблон не спрацював — ТУТ, а не в логу контейнера
                        (Р13.7). Доти рушій гасив шаблон із першої відмови й
                        мовчав: оренда просто переставала нараховуватись. */}
                    {t.last_error && (
                      <div style={{ fontSize: 11, color: 'var(--accent-warning)', marginTop: 2 }}>
                        {t.is_active
                          ? `${tUi('Остання спроба не вдалася')} (${t.failed_runs}×): ${t.last_error}`
                          : `${tUi('Вимкнено після невдалих спроб')} (${t.failed_runs}×): ${t.last_error}`}
                      </div>
                    )}
                  </td>
                  <td style={td}>{tUi(OP_TYPE_LABEL[t.op_type])}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {formatAmount(t.amount, t.currency)}
                  </td>
                  <td style={td}>
                    {tUi(SCHEDULE_LABELS[t.schedule])}{t.schedule === 'monthly' && t.schedule_day ? ` (${t.schedule_day}${tUi('-го)')}` : ''}
                  </td>
                  <td style={td}>{t.next_run_at}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--text-secondary)' }}>{t.runs_created}×</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => handleRunNow(t)} style={{ ...iconBtn, color: '#22c55e' }} title={tUi('Виконати зараз')} disabled={!t.is_active}>
                      <Play size={14} />
                    </button>
                    <button onClick={() => setEditing(t)} style={iconBtn} title={tUi('Редагувати')}><Pencil size={14} /></button>
                    <button onClick={() => handleToggle(t)} style={iconBtn} title={t.is_active ? tUi('Вимкнути') : tUi('Увімкнути')}>
                      <RotateCcw size={14} />
                    </button>
                    <button onClick={() => handleDelete(t)} style={{ ...iconBtn, color: '#dc2626' }} title={tUi('Видалити')}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RecurringTemplateModal
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(vals) => handleSave(vals, editing !== 'new' ? editing.id : undefined)}
        />
      )}
    </div>
  );
}

const btnAdd: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  background: 'var(--accent, #6366f1)', color: '#fff', border: 'none',
  borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
};
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: 'center', color: 'var(--text-secondary)',
  border: '1px dashed var(--border-primary)', borderRadius: 10,
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontWeight: 600, fontSize: 13,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)',
};
const td: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };
const iconBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 5, margin: '0 2px',
  cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: 6,
};
