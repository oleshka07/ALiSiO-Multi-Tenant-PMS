'use client';

import { useState, useEffect, useCallback } from 'react';
import { Landmark, Plus, Edit2, Trash2, X } from 'lucide-react';

interface BU { id: string; name: string; }

interface CapexItem {
  id: string; name: string; asset_type: string; amount: number; counterparty: string;
  purchase_date: string; month: string; useful_life_months: number; depreciation_monthly: number;
  status: string; bu_name: string; business_unit_id: string; notes: string;
}

interface Summary { total_items: number; total_amount: number; active_items: number; monthly_depreciation: number; }

const ASSET_TYPES: Record<string, string> = {
  construction: '🏗️ Будівництво', equipment: '⚙️ Обладнання', furniture: '🪑 Меблі',
  vehicle: '🚗 Транспорт', IT: '💻 IT', other: '📋 Інше',
};

function formatCZK(n: number): string {
  return `${Math.round(n).toLocaleString('cs-CZ')} CZK`;
}

export default function CapexPage() {
  const [items, setItems] = useState<CapexItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_items: 0, total_amount: 0, active_items: 0, monthly_depreciation: 0 });
  const [bus, setBus] = useState<BU[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', asset_type: 'construction', business_unit_id: '', amount: '', counterparty: '', purchase_date: new Date().toISOString().substring(0, 10), useful_life_months: '60', notes: '' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, buRes] = await Promise.all([fetch('/api/finance/capex'), fetch('/api/finance/business-units')]);
      const data = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || {});
      setBus(await buRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ name: '', asset_type: 'construction', business_unit_id: '', amount: '', counterparty: '', purchase_date: new Date().toISOString().substring(0, 10), useful_life_months: '60', notes: '' });
    setShowModal(true);
  };

  const openEdit = (item: CapexItem) => {
    setEditingId(item.id);
    setForm({ name: item.name, asset_type: item.asset_type || 'construction', business_unit_id: item.business_unit_id || '', amount: String(item.amount), counterparty: item.counterparty || '', purchase_date: item.purchase_date, useful_life_months: String(item.useful_life_months || ''), notes: item.notes || '' });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    const body = { ...form, amount: parseFloat(form.amount), useful_life_months: parseInt(form.useful_life_months) || null, business_unit_id: form.business_unit_id || null };
    try {
      if (editingId) {
        await fetch(`/api/finance/capex/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await fetch('/api/finance/capex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      setShowModal(false);
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Видалити цей CAPEX?')) return;
    await fetch(`/api/finance/capex/${id}`, { method: 'DELETE' });
    fetchData();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Landmark size={28} /> CAPEX — Реєстр капітальних витрат</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Будівництво, обладнання, активи з амортизацією</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={18} /> Додати CAPEX</button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Всього CAPEX', value: formatCZK(summary.total_amount), color: '#0ea5e9' },
          { label: 'Активних', value: String(summary.active_items), color: '#22c55e' },
          { label: 'Всього записів', value: String(summary.total_items), color: '#8b5cf6' },
          { label: 'Амортизація / міс', value: formatCZK(summary.monthly_depreciation), color: '#f59e0b' },
        ].map((card, i) => (
          <div key={i} className="card" style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{card.label}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: card.color, marginTop: '0.25rem' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" /></div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            <Landmark size={48} strokeWidth={1} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
            <p>Немає капітальних витрат</p>
            <button className="btn btn-primary" onClick={openAdd} style={{ marginTop: '1rem' }}><Plus size={16} /> Додати перший CAPEX</button>
          </div>
        ) : (
          <table className="data-table" style={{ fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th>Назва</th><th>Тип</th><th>BU</th><th>Дата</th>
                <th style={{ textAlign: 'right' }}>Сума</th><th>Строк (міс)</th>
                <th style={{ textAlign: 'right' }}>Амортизація/міс</th><th>Статус</th><th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td>{ASSET_TYPES[item.asset_type] || item.asset_type}</td>
                  <td>{item.bu_name || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.purchase_date}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCZK(item.amount)}</td>
                  <td style={{ textAlign: 'center' }}>{item.useful_life_months || '—'}</td>
                  <td style={{ textAlign: 'right', color: '#f59e0b' }}>{item.depreciation_monthly > 0 ? formatCZK(item.depreciation_monthly) : '—'}</td>
                  <td>
                    <span style={{ padding: '0.15rem 0.5rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                      background: item.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
                      color: item.status === 'active' ? '#22c55e' : '#6b7280'
                    }}>{item.status === 'active' ? '✅ Активний' : item.status}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn-icon" onClick={() => openEdit(item)}><Edit2 size={14} /></button>
                      <button className="btn-icon" onClick={() => handleDelete(item.id)} style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>{editingId ? 'Редагувати CAPEX' : 'Новий CAPEX'}</h2>
              <button className="btn-icon" onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label>Назва *</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Реконструкція даху будова F"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>Тип активу</label>
                  <select value={form.asset_type} onChange={e => setForm({ ...form, asset_type: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
                    {Object.entries(ASSET_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Бізнес-юніт</label>
                  <select value={form.business_unit_id} onChange={e => setForm({ ...form, business_unit_id: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
                    <option value="">Оберіть BU</option>
                    {bus.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>Сума (CZK) *</label>
                  <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="500000"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
                <div className="form-group">
                  <label>Дата *</label>
                  <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label>Контрагент</label>
                  <input type="text" value={form.counterparty} onChange={e => setForm({ ...form, counterparty: e.target.value })} placeholder="Назва підрядника"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
                <div className="form-group">
                  <label>Корисний строк (місяців)</label>
                  <input type="number" value={form.useful_life_months} onChange={e => setForm({ ...form, useful_life_months: e.target.value })} placeholder="60"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              {form.amount && form.useful_life_months && parseInt(form.useful_life_months) > 0 && (
                <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(245,158,11,0.1)', fontSize: '0.85rem' }}>
                  📊 Амортизація: <strong>{formatCZK(parseFloat(form.amount) / parseInt(form.useful_life_months))} / місяць</strong>
                  {' '}({parseInt(form.useful_life_months)} місяців = {Math.round(parseInt(form.useful_life_months) / 12 * 10) / 10} років)
                </div>
              )}
              <div className="form-group">
                <label>Нотатки</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)', resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Скасувати</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.name || !form.amount}>{editingId ? 'Зберегти' : 'Додати'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
