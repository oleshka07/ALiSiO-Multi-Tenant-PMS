'use client';

import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, Plus, CheckCircle, X, Clock, Edit2, Trash2 } from 'lucide-react';

interface Category { id: string; name: string; icon: string; color: string; }
interface BU { id: string; name: string; }

interface Accrual {
  id: string; description: string; amount: number; month: string; accrual_type: string;
  status: string; category_name: string; category_icon: string; category_color: string;
  bu_name: string; category_id: string; business_unit_id: string; notes: string;
}

interface Summary { pending_total: number; paid_total: number; pending_count: number; paid_count: number; total_count: number; }

function formatCZK(n: number): string { return `${Math.round(Math.abs(n)).toLocaleString('cs-CZ')} CZK`; }

const STATUS_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: '⏳ Очікує', bg: 'rgba(234,179,8,0.15)', color: '#eab308' },
  paid: { label: '✅ Оплачено', bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
  reversed: { label: '↩️ Скасовано', bg: 'rgba(107,114,128,0.15)', color: '#6b7280' },
};

export default function AccrualsPage() {
  const [items, setItems] = useState<Accrual[]>([]);
  const [summary, setSummary] = useState<Summary>({ pending_total: 0, paid_total: 0, pending_count: 0, paid_count: 0, total_count: 0 });
  const [categories, setCategories] = useState<Category[]>([]);
  const [bus, setBus] = useState<BU[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [filterStatus, setFilterStatus] = useState('');
  const [form, setForm] = useState({ category_id: '', business_unit_id: '', description: '', amount: '', month: '', accrual_type: 'expense', notes: '' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (filterStatus) params.set('status', filterStatus);
    try {
      const [res, catRes, buRes] = await Promise.all([
        fetch(`/api/finance/accruals?${params}`), fetch('/api/finance/expense-categories'), fetch('/api/finance/business-units'),
      ]);
      const data = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || {});
      setCategories(await catRes.json());
      setBus(await buRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [month, filterStatus]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ category_id: '', business_unit_id: '', description: '', amount: '', month, accrual_type: 'expense', notes: '' });
    setShowModal(true);
  };

  const openEdit = (item: Accrual) => {
    setEditingId(item.id);
    setForm({ category_id: item.category_id || '', business_unit_id: item.business_unit_id || '', description: item.description, amount: String(Math.abs(item.amount)), month: item.month, accrual_type: item.accrual_type, notes: item.notes || '' });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    const body = { ...form, amount: parseFloat(form.amount) * (form.accrual_type === 'expense' ? -1 : 1), category_id: form.category_id || null, business_unit_id: form.business_unit_id || null };
    try {
      if (editingId) {
        await fetch(`/api/finance/accruals/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await fetch('/api/finance/accruals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      setShowModal(false); fetchData();
    } catch (e) { console.error(e); }
  };

  const markPaid = async (id: string) => {
    await fetch(`/api/finance/accruals/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paid' }) });
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Видалити нарахування?')) return;
    await fetch(`/api/finance/accruals/${id}`, { method: 'DELETE' });
    fetchData();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ClipboardList size={28} /> Нарахування (Accruals)</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Неоплачені витрати для точного P&L</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={18} /> Додати нарахування</button>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Очікує оплати</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#eab308' }}>{formatCZK(summary.pending_total)} <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>({summary.pending_count})</span></div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Оплачено</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#22c55e' }}>{formatCZK(summary.paid_total)} <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>({summary.paid_count})</span></div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Всього</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{summary.total_count} записів</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
          <option value="">Всі статуси</option>
          <option value="pending">⏳ Очікує</option>
          <option value="paid">✅ Оплачено</option>
          <option value="reversed">↩️ Скасовано</option>
        </select>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" /></div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            <ClipboardList size={48} strokeWidth={1} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
            <p>Немає нарахувань за обраний період</p>
          </div>
        ) : (
          <table className="data-table" style={{ fontSize: '0.85rem' }}>
            <thead>
              <tr><th>Місяць</th><th>Категорія</th><th>Опис</th><th>BU</th><th style={{ textAlign: 'right' }}>Сума</th><th>Статус</th><th style={{ width: 120 }}></th></tr>
            </thead>
            <tbody>
              {items.map(item => {
                const badge = STATUS_BADGES[item.status] || STATUS_BADGES.pending;
                return (
                  <tr key={item.id}>
                    <td>{item.month}</td>
                    <td>{item.category_icon} {item.category_name || '—'}</td>
                    <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                    <td>{item.bu_name || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: item.amount >= 0 ? '#22c55e' : '#ef4444' }}>{formatCZK(item.amount)}</td>
                    <td><span style={{ padding: '0.15rem 0.5rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: badge.bg, color: badge.color }}>{badge.label}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {item.status === 'pending' && (
                          <button className="btn-icon" onClick={() => markPaid(item.id)} title="Оплачено" style={{ color: '#22c55e' }}><CheckCircle size={14} /></button>
                        )}
                        <button className="btn-icon" onClick={() => openEdit(item)}><Edit2 size={14} /></button>
                        <button className="btn-icon" onClick={() => handleDelete(item.id)} style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>{editingId ? 'Редагувати' : 'Нове нарахування'}</h2>
              <button className="btn-icon" onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className={`btn ${form.accrual_type === 'expense' ? 'btn-primary' : ''}`} style={{ flex: 1, background: form.accrual_type === 'expense' ? '#ef4444' : undefined, borderColor: form.accrual_type === 'expense' ? '#ef4444' : undefined }} onClick={() => setForm({ ...form, accrual_type: 'expense' })}>📤 Витрата</button>
                <button className={`btn ${form.accrual_type === 'revenue' ? 'btn-primary' : ''}`} style={{ flex: 1, background: form.accrual_type === 'revenue' ? '#22c55e' : undefined, borderColor: form.accrual_type === 'revenue' ? '#22c55e' : undefined }} onClick={() => setForm({ ...form, accrual_type: 'revenue' })}>📥 Дохід</button>
              </div>
              <div className="form-group">
                <label>Опис *</label>
                <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Зарплати березень"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>Сума (CZK) *</label>
                  <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="150000"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
                <div className="form-group">
                  <label>Місяць P&L *</label>
                  <input type="month" value={form.month} onChange={e => setForm({ ...form, month: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>Категорія</label>
                  <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
                    <option value="">Оберіть</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>BU</label>
                  <select value={form.business_unit_id} onChange={e => setForm({ ...form, business_unit_id: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
                    <option value="">Оберіть</option>
                    {bus.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Нотатки</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)', resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Скасувати</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.description || !form.amount || !form.month}>{editingId ? 'Зберегти' : 'Додати'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
