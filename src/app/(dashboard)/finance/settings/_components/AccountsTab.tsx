'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Archive, Trash2, Scale, RotateCcw } from 'lucide-react';
import AccountModal, { AccountFormValues } from './AccountModal';
import ReconcileModal from './ReconcileModal';

export interface Account {
  id: string;
  name: string;
  type: 'cash' | 'bank' | 'card' | 'investment' | 'other';
  currency: string;
  initial_balance: number;
  credit_limit: number | null;
  color: string;
  is_active: number;
  sort_order: number;
  balance: number;
}

const TYPE_LABELS: Record<Account['type'], string> = {
  cash: 'Готівка',
  bank: 'Банк',
  card: 'Картка',
  investment: 'Інвестиції',
  other: 'Інше',
};

function formatMoney(n: number, currency: string): string {
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${formatted} ${currency}`;
}

export default function AccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [reconciling, setReconciling] = useState<Account | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const url = showArchived ? '/api/finance/accounts?archived=1' : '/api/finance/accounts';
      const res = await fetch(url);
      const json = await res.json();
      setAccounts(Array.isArray(json) ? json : []);
    } catch (e) {
      console.error('Failed to load accounts', e);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  async function handleSave(values: AccountFormValues) {
    const isEdit = editing !== 'new' && editing !== null;
    const url = '/api/finance/accounts';
    const method = isEdit ? 'PATCH' : 'POST';
    const payload = isEdit ? { id: (editing as Account).id, ...values } : values;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Помилка збереження');
    }
    setEditing(null);
    fetchAccounts();
  }

  async function handleArchiveToggle(account: Account) {
    const willArchive = account.is_active === 1;
    const verb = willArchive ? 'архівувати' : 'відновити';
    if (!confirm(`${verb[0].toUpperCase()}${verb.slice(1)} рахунок «${account.name}»?`)) return;
    const res = await fetch('/api/finance/accounts/archive', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: account.id, archived: willArchive }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося');
      return;
    }
    fetchAccounts();
  }

  async function handleDelete(account: Account) {
    if (!confirm(`Видалити рахунок «${account.name}» остаточно? Це можливо тільки якщо до рахунку не прив'язано жодної операції.`)) return;
    const res = await fetch(`/api/finance/accounts/${account.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося видалити');
      return;
    }
    fetchAccounts();
  }

  const activeCount = accounts.filter((a) => a.is_active === 1).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Рахунки</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {activeCount} активних
        </span>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Показати архівовані
        </label>
        <button
          onClick={() => setEditing('new')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: 'var(--accent, #6366f1)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          <Plus size={16} /> Додати рахунок
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Завантаження…</div>
      ) : accounts.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: 'var(--text-secondary)',
            border: '1px dashed var(--border-primary)',
            borderRadius: 10,
          }}
        >
          Рахунків ще немає. Натисніть «Додати рахунок», щоб створити перший.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={thStyle}>Назва</th>
                <th style={thStyle}>Тип</th>
                <th style={thStyle}>Валюта</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Стартовий</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Поточний</th>
                <th style={{ ...thStyle, width: 180 }}>Дії</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const isCard = a.type === 'card';
                const displayBalance = isCard && a.credit_limit !== null
                  ? `${formatMoney((a.credit_limit || 0) + a.balance, a.currency)} доступно`
                  : formatMoney(a.balance, a.currency);
                return (
                  <tr
                    key={a.id}
                    style={{
                      borderTop: '1px solid var(--border-primary)',
                      opacity: a.is_active ? 1 : 0.5,
                    }}
                  >
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: a.color,
                          marginRight: 8,
                          verticalAlign: 'middle',
                        }}
                      />
                      {a.name}
                      {!a.is_active && <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 6 }}>(архів)</span>}
                    </td>
                    <td style={tdStyle}>{TYPE_LABELS[a.type]}</td>
                    <td style={tdStyle}>{a.currency}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatMoney(a.initial_balance, a.currency)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{displayBalance}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button style={iconBtnStyle} title="Редагувати" onClick={() => setEditing(a)}>
                        <Pencil size={15} />
                      </button>
                      <button style={iconBtnStyle} title="Звірка" onClick={() => setReconciling(a)}>
                        <Scale size={15} />
                      </button>
                      <button
                        style={iconBtnStyle}
                        title={a.is_active ? 'Архівувати' : 'Відновити'}
                        onClick={() => handleArchiveToggle(a)}
                      >
                        {a.is_active ? <Archive size={15} /> : <RotateCcw size={15} />}
                      </button>
                      <button
                        style={{ ...iconBtnStyle, color: '#dc2626' }}
                        title="Видалити"
                        onClick={() => handleDelete(a)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AccountModal
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {reconciling && (
        <ReconcileModal
          account={reconciling}
          onClose={() => setReconciling(null)}
          onDone={() => {
            setReconciling(null);
            fetchAccounts();
          }}
        />
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontWeight: 600,
  fontSize: 13,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-primary)',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  verticalAlign: 'middle',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 6,
  margin: '0 2px',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  borderRadius: 6,
};
