'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Play, Wand2, GripVertical } from 'lucide-react';
import AutoRuleModal, { AutoRuleFormValues } from './AutoRuleModal';

export interface AutoRule {
  id: string;
  name: string;
  op_type: 'income' | 'expense' | 'any';
  conditions: any[];
  actions: {
    set_category_id?: string | null;
    set_project_id?: string | null;
    set_counterparty_id?: string | null;
    auto_match_counterparty?: boolean;
    add_tag_ids?: string[];
    set_comment?: string;
  };
  is_active: number;
  stop_on_match: number;
  sort_order: number;
  match_count: number;
}

const OP_TYPE_LABEL: Record<string, string> = {
  income: 'Дохід',
  expense: 'Витрата',
  any: 'Будь-який',
};

export default function AutoRulesTab() {
  const [rules, setRules] = useState<AutoRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AutoRule | 'new' | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [matchBusy, setMatchBusy] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/auto-rules');
      const json = await res.json();
      setRules(Array.isArray(json) ? json : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  async function handleSave(values: AutoRuleFormValues, id?: string) {
    const res = await fetch(id ? `/api/finance/auto-rules/${id}` : '/api/finance/auto-rules', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Помилка збереження');
    }
    setEditing(null);
    fetchRules();
  }

  async function handleDelete(r: AutoRule) {
    if (!confirm(`Видалити правило «${r.name}»? Історія спрацьовувань також буде видалена.`)) return;
    const res = await fetch(`/api/finance/auto-rules/${r.id}`, { method: 'DELETE' });
    if (!res.ok) { alert('Не вдалося'); return; }
    fetchRules();
  }

  async function handleToggle(r: AutoRule) {
    const res = await fetch(`/api/finance/auto-rules/${r.id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !r.is_active }),
    });
    if (!res.ok) { alert('Не вдалося'); return; }
    fetchRules();
  }

  async function handleApplyAll() {
    if (!confirm('Застосувати всі активні правила до існуючих операцій? Це перезапише категорію/проєкт/контрагента для тих операцій, що відповідають умовам.')) return;
    setApplyBusy(true);
    try {
      const res = await fetch('/api/finance/auto-rules/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      alert(`Оброблено ${json.processed} операцій.\nЗмінено: ${json.changed}.\nПравил задіяно: ${json.rulesCount}.`);
      fetchRules();
    } catch (e: any) { alert(e.message); }
    setApplyBusy(false);
  }

  async function handleAutoMatchCounterparties() {
    if (!confirm('Автоматчинг контрагентів по aliases — пройде по всіх операціях без контрагента і встановить, якщо знайде збіг у коментарі?')) return;
    setMatchBusy(true);
    try {
      const res = await fetch('/api/finance/auto-rules/auto-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ only_unmatched: true }),
      });
      const json = await res.json();
      alert(`Оброблено ${json.processed} операцій.\nЗнайдено контрагентів: ${json.matched}.`);
    } catch (e: any) { alert(e.message); }
    setMatchBusy(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Автоправила</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {rules.filter((r) => r.is_active).length} активних з {rules.length}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleAutoMatchCounterparties} disabled={matchBusy} style={{ ...btnSec, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Wand2 size={14} /> {matchBusy ? 'Пошук…' : 'Автоматчинг контрагентів'}
        </button>
        <button onClick={handleApplyAll} disabled={applyBusy} style={{ ...btnSec, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Play size={14} /> {applyBusy ? 'Застосування…' : 'Застосувати до існуючих'}
        </button>
        <button onClick={() => setEditing('new')} style={btnAdd}>
          <Plus size={16} /> Додати правило
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : rules.length === 0 ? (
        <div style={emptyStyle}>
          Правил ще немає. Створіть перше, щоб автоматично категоризувати операції за підрядком коментаря (напр. «FACEBK» → Маркетинг).
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={th}></th>
                <th style={th}>Назва</th>
                <th style={th}>Тип</th>
                <th style={{ ...th, textAlign: 'right' }}>Умов</th>
                <th style={{ ...th, textAlign: 'right' }}>Спрацьовано</th>
                <th style={{ ...th, width: 80 }}>Активне</th>
                <th style={{ ...th, width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border-primary)', opacity: r.is_active ? 1 : 0.5 }}>
                  <td style={td}><GripVertical size={14} style={{ color: 'var(--text-secondary)' }} /></td>
                  <td style={{ ...td, fontWeight: 500 }}>
                    {r.name}
                    {r.stop_on_match ? <span style={badgeSmall} title="Зупиняє подальші правила">stop</span> : null}
                  </td>
                  <td style={td}>{OP_TYPE_LABEL[r.op_type]}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.conditions.length}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--text-secondary)' }}>{r.match_count}×</td>
                  <td style={td}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!r.is_active} onChange={() => handleToggle(r)} />
                    </label>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing(r)} style={iconBtn} title="Редагувати"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(r)} style={{ ...iconBtn, color: '#dc2626' }} title="Видалити"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AutoRuleModal
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
const btnSec: React.CSSProperties = {
  padding: '8px 12px', background: 'transparent', color: 'var(--text-primary)',
  border: '1px solid var(--border-primary)', borderRadius: 8, cursor: 'pointer', fontSize: 12,
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
  background: 'transparent', border: 'none', padding: 6, margin: '0 2px',
  cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: 6,
};
const badgeSmall: React.CSSProperties = {
  marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4,
  background: '#fee2e2', color: '#dc2626',
};
