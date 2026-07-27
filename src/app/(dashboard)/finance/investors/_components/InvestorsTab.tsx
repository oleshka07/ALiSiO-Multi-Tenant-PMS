'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Edit, RefreshCw, Copy, ExternalLink } from 'lucide-react';

interface Investor {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  telegram_chat_id: string | null;
  portal_token: string;
  status: string;
  notes: string | null;
  total_invested: number;
  total_paid_out: number;
  active_lots: number;
}

function fmt(n: number): string {
  return n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InvestorsTab() {
  const [items, setItems] = useState<Investor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Investor> | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/investors');
      const json = await res.json();
      setItems(json.items || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function save() {
    if (!editing?.name) { alert('Введи імʼя'); return; }
    try {
      const url = editing.id ? `/api/finance/investors/${editing.id}` : '/api/finance/investors';
      const method = editing.id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) });
      const j = await res.json();
      if (!res.ok) { alert(`Помилка: ${j.error}`); return; }
      setEditing(null);
      fetchItems();
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Видалити ${name}? Усі його інвестиції та виплати теж видаляться.`)) return;
    await fetch(`/api/finance/investors/${id}`, { method: 'DELETE' });
    fetchItems();
  }

  async function regenToken(id: string) {
    if (!confirm('Згенерувати новий токен? Старе посилання перестане працювати.')) return;
    await fetch(`/api/finance/investors/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerate_token: true }) });
    fetchItems();
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/invest/${token}`;
    navigator.clipboard.writeText(url).then(() => alert(`✓ Скопійовано: ${url}`));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={() => setEditing({ status: 'active' })} style={{ ...btn, background: '#3b82f6', color: '#fff', border: 'none' }}>
          <Plus size={14} /> Додати інвестора
        </button>
      </div>

      {loading ? <div>Завантаження…</div> : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-primary)', borderRadius: 8 }}>
          Інвесторів немає. Додай першого.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={th}>Імʼя</th>
                <th style={th}>Email / Phone</th>
                <th style={{ ...th, textAlign: 'right' }}>Лотів</th>
                <th style={{ ...th, textAlign: 'right' }}>Інвестовано</th>
                <th style={{ ...th, textAlign: 'right' }}>Виплачено</th>
                <th style={th}>Portal link</th>
                <th style={th}>Дії</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{i.name}</div>
                    {i.status === 'archived' && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(архів)</div>}
                  </td>
                  <td style={td}>
                    <div style={{ fontSize: 12 }}>{i.email || '—'}</div>
                    {i.phone && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{i.phone}</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{i.active_lots}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(i.total_invested)}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#22c55e' }}>{fmt(i.total_paid_out)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => copyLink(i.portal_token)} style={iconBtn} title="Копіювати посилання"><Copy size={14} /></button>
                      <a href={`/invest/${i.portal_token}`} target="_blank" rel="noopener noreferrer" style={iconBtn} title="Відкрити portal">
                        <ExternalLink size={14} />
                      </a>
                      <button onClick={() => regenToken(i.id)} style={iconBtn} title="Перегенерувати токен"><RefreshCw size={14} /></button>
                    </div>
                  </td>
                  <td style={td}>
                    <button onClick={() => setEditing(i)} style={iconBtn}><Edit size={14} /></button>
                    <button onClick={() => remove(i.id, i.name)} style={{ ...iconBtn, color: '#dc2626' }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div style={overlayStyle} onClick={() => setEditing(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, marginBottom: 16 }}>{editing.id ? 'Редагувати інвестора' : 'Новий інвестор'}</h3>
            <Field label="Імʼя *"><input style={input} value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Email"><input style={input} value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value || null })} /></Field>
            <Field label="Phone"><input style={input} value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value || null })} /></Field>
            <Field label="Telegram chat_id"><input style={input} value={editing.telegram_chat_id || ''} onChange={(e) => setEditing({ ...editing, telegram_chat_id: e.target.value || null })} /></Field>
            <Field label="Notes"><textarea style={{ ...input, minHeight: 60 }} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value || null })} /></Field>
            {editing.id && (
              <Field label="Status">
                <select style={input} value={editing.status || 'active'} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setEditing(null)} style={btn}>Відміна</button>
              <button onClick={save} style={{ ...btn, background: '#3b82f6', color: '#fff', border: 'none' }}>Зберегти</button>
            </div>
          </div>
        </div>
      )}
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

const input: React.CSSProperties = { padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)', width: '100%' };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 13, fontWeight: 500, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer' };
const iconBtn: React.CSSProperties = { background: 'transparent', border: 'none', padding: 5, cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: 6, display: 'inline-flex', alignItems: 'center' };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)' };
const td: React.CSSProperties = { padding: '8px 12px' };
const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const modalStyle: React.CSSProperties = { background: 'var(--bg-primary)', borderRadius: 12, padding: 24, minWidth: 480, maxWidth: 560 };
