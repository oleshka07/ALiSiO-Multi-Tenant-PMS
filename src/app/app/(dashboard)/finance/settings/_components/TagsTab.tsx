'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Archive, RotateCcw, Trash2 } from 'lucide-react';
import TagModal, { TagFormValues } from './TagModal';

export interface Tag {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_active: number;
  created_at: string;
}

export default function TagsTab() {
  const tUi = useT();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Tag | 'new' | null>(null);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const url = showArchived ? '/api/finance/tags?archived=1' : '/api/finance/tags';
      const res = await fetch(url);
      const json = await res.json();
      setTags(Array.isArray(json) ? json : []);
    } catch (e) {
      console.error('Failed to load tags', e);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { fetchTags(); }, [fetchTags]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tags;
    const needle = search.trim().toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tags, search]);

  async function handleSave(values: TagFormValues, existingId?: string) {
    const method = existingId ? 'PATCH' : 'POST';
    const url = existingId ? `/api/finance/tags/${existingId}` : '/api/finance/tags';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Помилка збереження');
    }
    setEditing(null);
    fetchTags();
  }

  async function handleDelete(tag: Tag) {
    if (!confirm(`Видалити тег «${tag.name}»?`)) return;
    const res = await fetch(`/api/finance/tags/${tag.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося видалити');
      return;
    }
    fetchTags();
  }

  async function handleArchiveToggle(tag: Tag) {
    const willArchive = tag.is_active === 1;
    const res = await fetch(`/api/finance/tags/${tag.id}/archive`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: willArchive }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося');
      return;
    }
    fetchTags();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{tUi('Теги')}</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {tags.filter((t) => t.is_active).length} {tUi('активних')}
        </span>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {tUi('Показати архівовані')}
        </label>
        <button onClick={() => setEditing('new')} style={addBtnStyle}>
          <Plus size={16} /> {tUi('Додати тег')}
        </button>
      </div>

      <input
        type="text"
        placeholder={tUi('Пошук тега...')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={searchStyle}
      />

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{tUi('Завантаження…')}</div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>
          {search ? 'Нічого не знайдено.' : 'Тегів ще немає. Теги — це крос-тематичні мітки для операцій (напр. «Терміново», «Одноразове», «На перегляд»).'}
        </div>
      ) : (
        <>
          <div style={previewBoxStyle}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {tUi('Попередній вигляд:')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {filtered.filter((t) => t.is_active).map((t) => (
                <span key={t.id} style={{ ...chipStyle, background: t.color, color: readableText(t.color) }}>
                  {t.name}
                </span>
              ))}
            </div>
          </div>

          <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={thStyle}>{tUi('Тег')}</th>
                  <th style={thStyle}>{tUi('Колір')}</th>
                  <th style={{ ...thStyle, width: 100, textAlign: 'right' }}>{tUi('Порядок')}</th>
                  <th style={{ ...thStyle, width: 160 }}>{tUi('Дії')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    style={{
                      borderTop: '1px solid var(--border-primary)',
                      opacity: t.is_active ? 1 : 0.5,
                    }}
                  >
                    <td style={tdStyle}>
                      <span style={{ ...chipStyle, background: t.color, color: readableText(t.color) }}>
                        {t.name}
                      </span>
                      {!t.is_active && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 8 }}>{tUi('(архів)')}</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-block', width: 16, height: 16, borderRadius: 4,
                        background: t.color, verticalAlign: 'middle', marginRight: 8,
                      }} />
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.color}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{t.sort_order}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEditing(t)} style={iconBtnStyle} title={tUi('Редагувати')}><Pencil size={14} /></button>
                      <button
                        onClick={() => handleArchiveToggle(t)}
                        style={iconBtnStyle}
                        title={t.is_active ? 'Архівувати' : 'Відновити'}
                      >
                        {t.is_active ? <Archive size={14} /> : <RotateCcw size={14} />}
                      </button>
                      <button onClick={() => handleDelete(t)} style={{ ...iconBtnStyle, color: '#dc2626' }} title={tUi('Видалити')}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <TagModal
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(vals) => handleSave(vals, editing !== 'new' ? editing.id : undefined)}
        />
      )}
    </div>
  );
}

function readableText(bg: string): string {
  const hex = bg.replace('#', '');
  if (hex.length !== 6) return '#000';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000' : '#fff';
}

const addBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  background: 'var(--accent, #6366f1)', color: '#fff', border: 'none',
  borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
};
const searchStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border-primary)',
  borderRadius: 8, fontSize: 14, background: 'var(--bg-primary)',
  color: 'var(--text-primary)', marginBottom: 16,
};
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: 'center', color: 'var(--text-secondary)',
  border: '1px dashed var(--border-primary)', borderRadius: 10,
};
const previewBoxStyle: React.CSSProperties = {
  padding: 12, marginBottom: 12,
  background: 'var(--bg-secondary)', borderRadius: 8,
  border: '1px solid var(--border-primary)',
};
const chipStyle: React.CSSProperties = {
  display: 'inline-block', padding: '3px 10px', borderRadius: 12,
  fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontWeight: 600, fontSize: 13,
  color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)',
};
const tdStyle: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 6, margin: '0 2px',
  cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: 6,
};
