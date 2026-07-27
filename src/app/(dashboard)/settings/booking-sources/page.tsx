'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/lib/MobileMenuContext';
import { Plus, Edit3, Trash2, X, Save, Loader2, ArrowLeft, Palette } from 'lucide-react';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface BookingSource {
  id: string;
  name: string;
  code: string;
  icon_letter: string;
  color: string;
  sort_order: number;
  is_active: number;
  commission_percent: number;
}

const PRESET_COLORS = [
  '#22c55e', '#3b82f6', '#25D366', '#003580', '#FF5A5F',
  '#f59e0b', '#a78bfa', '#ef4444', '#14b8a6', '#f97316',
  '#8b5cf6', '#ec4899',
];

function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export default function BookingSourcesPage() {
  const [sources, setSources] = useState<BookingSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editSource, setEditSource] = useState<BookingSource | null>(null);
  const [form, setForm] = useState({ name: '', code: '', icon_letter: '', color: '#3b82f6', sort_order: 0, commission_percent: 0 });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const onMenuClick = useMobileMenu();

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/booking-sources');
      const data = await res.json();
      setSources(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const openNew = () => {
    setEditSource(null);
    setForm({ name: '', code: '', icon_letter: '', color: '#3b82f6', sort_order: sources.length + 1, commission_percent: 0 });
    setShowModal(true);
  };

  const openEdit = (s: BookingSource) => {
    setEditSource(s);
    setForm({ name: s.name, code: s.code, icon_letter: s.icon_letter, color: s.color, sort_order: s.sort_order, commission_percent: s.commission_percent || 0 });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.code) return;
    setSaving(true);
    try {
      const url = editSource ? `/api/booking-sources/${editSource.id}` : '/api/booking-sources';
      const method = editSource ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(`❌ ${data.error}`);
      } else {
        showToast(editSource ? '✅ Джерело оновлено' : '✅ Джерело створено');
        setShowModal(false);
        fetchSources();
      }
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleDelete = async (s: BookingSource) => {
    if (!confirm(`Видалити джерело "${s.name}"?`)) return;
    try {
      const res = await fetch(`/api/booking-sources/${s.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        showToast(`❌ ${data.error}`);
      } else {
        showToast('✅ Видалено');
        fetchSources();
      }
    } catch (e) { console.error(e); }
  };

  // Auto-generate code from name
  const handleNameChange = (name: string) => {
    setForm(p => ({
      ...p,
      name,
      code: editSource ? p.code : name.toLowerCase().replace(/[\s.]+/g, '_').replace(/[^a-z0-9_]/g, ''),
      icon_letter: editSource ? p.icon_letter : (name.charAt(0).toUpperCase() || '?'),
    }));
  };

  return (
    <>
      <Header title="Джерела бронювань" onMenuClick={onMenuClick} />
      <div className="app-content">
        {toast && (
          <div style={{
            position: 'fixed', top: 80, right: 24, zIndex: 1000,
            background: toast.startsWith('❌') ? 'var(--accent-danger)' : 'var(--accent-success)',
            color: '#fff', padding: '12px 20px', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            animation: 'fadeIn 0.3s ease',
          }}>
            {toast}
          </div>
        )}

        <div className="page-header">
          <div>
            <Link href="/settings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 4, textDecoration: 'none' }}>
              <ArrowLeft size={14} /> Налаштування
            </Link>
            <h2 className="page-title">Джерела бронювань</h2>
            <div className="page-subtitle">Booking.com, Airbnb, Direct та інші канали</div>
          </div>
          <button className="btn btn-primary" onClick={openNew}>
            <Plus size={16} /> Додати
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64 }}>
            <Loader2 size={24} className="animate-pulse" style={{ display: 'inline-block' }} /> Завантаження...
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="table-wrapper desktop-only">
              <table className="table">
                <thead>
                  <tr>
                    <th>Іконка</th>
                    <th>Назва</th>
                    <th>Код</th>
                    <th>Комісія</th>
                    <th>Порядок</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: s.color, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 13,
                        }}>
                          {s.icon_letter}
                        </div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td><span className="badge badge-info">{s.code}</span></td>
                      <td>
                        {s.commission_percent > 0
                          ? <span className="badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 700 }}>{s.commission_percent}%</span>
                          : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>}
                      </td>
                      <td>{s.sort_order}</td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-sm btn-ghost btn-icon" onClick={() => openEdit(s)}><Edit3 size={14} /></button>
                          <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }} onClick={() => handleDelete(s)}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="mobile-only">
              <div className="card-list">
                {sources.map((s) => (
                  <div key={s.id} className="guest-card" onClick={() => openEdit(s)}>
                    <div style={{
                      width: 42, height: 42, borderRadius: '50%',
                      background: s.color, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 16, flexShrink: 0,
                    }}>
                      {s.icon_letter}
                    </div>
                    <div className="guest-card-info">
                      <div className="guest-card-name">{s.name}</div>
                      <div className="guest-card-detail">
                        <span className="badge badge-info" style={{ fontSize: 10, padding: '1px 6px' }}>{s.code}</span>
                        {s.commission_percent > 0 && (
                          <span className="badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontSize: 10, padding: '1px 6px', marginLeft: 4 }}>{s.commission_percent}%</span>
                        )}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <button className="btn btn-sm btn-ghost btn-icon" style={{ color: 'var(--accent-danger)' }}
                        onClick={(e) => { e.stopPropagation(); handleDelete(s); }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Create/Edit Modal */}
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          title={editSource ? 'Редагувати джерело' : 'Нове джерело'}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Скасувати</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name || !form.code}>
                <Save size={16} /> {saving ? 'Збереження...' : 'Зберегти'}
              </button>
            </>
          }
        >
          <div className="form-group">
            <label className="form-label">Назва *</label>
            <input className="form-input" placeholder="Booking.com" value={form.name}
              onChange={(e) => handleNameChange(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Код (унікальний) *</label>
            <input className="form-input" placeholder="booking_com" value={form.code}
              onChange={(e) => setForm(p => ({ ...p, code: e.target.value }))} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Іконка (літера/emoji)</label>
              <input className="form-input" placeholder="B" value={form.icon_letter} maxLength={2}
                onChange={(e) => setForm(p => ({ ...p, icon_letter: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Порядок</label>
              <input className="form-input" type="number" value={form.sort_order}
                onChange={(e) => setForm(p => ({ ...p, sort_order: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">💰 Комісія OTA (%)</label>
            <input className="form-input" type="number" min="0" max="100" step="0.5" placeholder="0"
              value={form.commission_percent}
              onChange={(e) => setForm(p => ({ ...p, commission_percent: Number(e.target.value) }))} />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Залиште 0 для прямих бронювань (Direct, Phone, WhatsApp)
            </div>
          </div>
          <div className="form-group">
            <label className="form-label"><Palette size={14} style={{ verticalAlign: -2 }} /> Колір</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {PRESET_COLORS.map((c) => (
                <button key={c} onClick={() => setForm(p => ({ ...p, color: c }))}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: c, border: form.color === c ? '3px solid #fff' : '2px solid transparent',
                    cursor: 'pointer', boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none',
                  }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="color" value={form.color} onChange={(e) => setForm(p => ({ ...p, color: e.target.value }))}
                style={{ width: 40, height: 32, border: 'none', cursor: 'pointer' }} />
              <input className="form-input" value={form.color} onChange={(e) => setForm(p => ({ ...p, color: e.target.value }))}
                style={{ width: 100, fontSize: 12 }} />
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: form.color, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 14,
              }}>
                {form.icon_letter || '?'}
              </div>
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
}
