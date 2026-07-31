'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Edit, AlertCircle, CheckCircle2 } from 'lucide-react';

interface MonthlyReport {
  id: string;
  project_id: string;
  project_name: string;
  year_month: string;
  adr: number | null;
  general_comment: string | null;
  market_insight: string | null;
  operational_updates_json: string;
  photo_url: string | null;
  supabase_id?: string | null;
}

interface Project { id: string; name: string }
interface MetricKey { project_id: string; year_month: string }

export default function MonthlyReportsTab() {
  const [items, setItems] = useState<MonthlyReport[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [metrics, setMetrics] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<MonthlyReport> & { ops?: string[] } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, pRes, mRes] = await Promise.all([
        fetch('/api/finance/investor-monthly-reports'),
        fetch('/api/finance/investor-projects'),
        fetch('/api/finance/investor-monthly-metrics'),
      ]);
      const [rJ, pJ, mJ] = await Promise.all([rRes.json(), pRes.json(), mRes.json()]);
      setItems(rJ.items || []);
      setProjects(pJ.items || []);
      const set = new Set<string>();
      for (const m of mJ.items as MetricKey[]) set.add(`${m.project_id}|${m.year_month}`);
      setMetrics(set);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function save() {
    if (!editing?.project_id || !editing?.year_month) {
      alert('project_id і year_month обовʼязкові');
      return;
    }
    try {
      const res = await fetch('/api/finance/investor-monthly-reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: editing.project_id,
          year_month: editing.year_month,
          adr: editing.adr ?? null,
          general_comment: editing.general_comment || null,
          market_insight: editing.market_insight || null,
          operational_updates: editing.ops || [],
          photo_url: editing.photo_url || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) { alert(`Помилка: ${j.error}`); return; }
      setEditing(null);
      fetchAll();
    } catch (e: any) { alert(`Помилка: ${e.message}`); }
  }

  async function remove(id: string) {
    if (!confirm('Видалити звіт?')) return;
    await fetch(`/api/finance/investor-monthly-reports/${id}`, { method: 'DELETE' });
    fetchAll();
  }

  function openEdit(r: MonthlyReport) {
    let ops: string[] = [];
    try { ops = JSON.parse(r.operational_updates_json || '[]'); } catch { ops = []; }
    setEditing({ ...r, ops });
  }

  function openNew() {
    setEditing({ year_month: new Date().toISOString().substring(0, 7), ops: [] });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={openNew} style={{ ...btn, background: '#3b82f6', color: '#fff', border: 'none' }}>
          <Plus size={14} /> Додати звіт
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Звіти показуються у портал-сторінках інвестора. Бейдж показує, чи додані метрики (occupancy + revenue) для того ж проєкту/місяця у вкладці «Метрики».
      </p>

      {loading ? <div>Завантаження…</div> : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-primary)', borderRadius: 8 }}>
          Звітів ще немає.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={th}>Місяць</th>
                <th style={th}>Проєкт</th>
                <th style={{ ...th, textAlign: 'right' }}>ADR</th>
                <th style={th}>Коментар</th>
                <th style={th}>Метрики є?</th>
                <th style={th}>Дії</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const hasMetric = metrics.has(`${r.project_id}|${r.year_month}`);
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                    <td style={td}><b>{r.year_month}</b></td>
                    <td style={td}>{r.project_name}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.adr != null ? r.adr.toLocaleString('cs-CZ', { minimumFractionDigits: 2 }) : '—'}</td>
                    <td style={{ ...td, fontSize: 11, color: 'var(--text-secondary)' }}>{r.general_comment ? r.general_comment.substring(0, 60) + (r.general_comment.length > 60 ? '…' : '') : '—'}</td>
                    <td style={td}>
                      {hasMetric ? <span style={{ color: '#22c55e', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={13} /> ОК</span>
                                 : <span style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertCircle size={13} /> Немає</span>}
                    </td>
                    <td style={td}>
                      <button onClick={() => openEdit(r)} style={iconBtn}><Edit size={13} /></button>
                      <button onClick={() => remove(r.id)} style={{ ...iconBtn, color: '#dc2626' }}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div style={overlayStyle} onClick={() => setEditing(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, marginBottom: 16 }}>Місячний звіт</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 2 }}>
                <Field label="Проєкт *">
                  <select style={input} value={editing.project_id || ''} onChange={(e) => setEditing({ ...editing, project_id: e.target.value })}>
                    <option value="">—</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Місяць *"><input type="month" style={input} value={editing.year_month || ''} onChange={(e) => setEditing({ ...editing, year_month: e.target.value })} /></Field>
              </div>
            </div>
            <Field label="ADR (середній чек)"><input type="number" step="0.01" style={input} value={editing.adr ?? ''} onChange={(e) => setEditing({ ...editing, adr: e.target.value ? parseFloat(e.target.value) : null })} /></Field>
            <Field label="Загальний коментар"><textarea style={{ ...input, minHeight: 80 }} value={editing.general_comment || ''} onChange={(e) => setEditing({ ...editing, general_comment: e.target.value || null })} /></Field>
            <Field label="Market insight"><textarea style={{ ...input, minHeight: 60 }} value={editing.market_insight || ''} onChange={(e) => setEditing({ ...editing, market_insight: e.target.value || null })} /></Field>

            <Field label="Операційні апдейти (Enter додає новий)">
              <div>
                {(editing.ops || []).map((op, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    <input style={{ ...input, fontSize: 12 }} value={op} onChange={(e) => {
                      const next = [...(editing.ops || [])];
                      next[i] = e.target.value;
                      setEditing({ ...editing, ops: next });
                    }} />
                    <button onClick={() => setEditing({ ...editing, ops: (editing.ops || []).filter((_, j) => j !== i) })} style={{ ...iconBtn, color: '#dc2626' }}><Trash2 size={13} /></button>
                  </div>
                ))}
                <input style={{ ...input, fontSize: 12 }} placeholder="Натисни Enter щоб додати рядок"
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                           setEditing({ ...editing, ops: [...(editing.ops || []), e.currentTarget.value.trim()] });
                           e.currentTarget.value = '';
                         }
                       }} />
              </div>
            </Field>

            <Field label="URL фото (опц.)"><input style={input} value={editing.photo_url || ''} onChange={(e) => setEditing({ ...editing, photo_url: e.target.value || null })} /></Field>
            {editing.photo_url && <img src={editing.photo_url} alt="preview" style={{ maxWidth: 200, height: 120, objectFit: 'cover', borderRadius: 6, marginBottom: 10 }} />}

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
  return <div style={{ marginBottom: 10 }}><label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</label>{children}</div>;
}

const input: React.CSSProperties = { padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)', width: '100%' };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 13, fontWeight: 500, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer' };
const iconBtn: React.CSSProperties = { background: 'transparent', border: 'none', padding: 5, cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: 6 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)' };
const td: React.CSSProperties = { padding: '8px 12px' };
const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const modalStyle: React.CSSProperties = { background: 'var(--bg-primary)', borderRadius: 12, padding: 24, minWidth: 500, maxWidth: 640, maxHeight: '90vh', overflow: 'auto' };
