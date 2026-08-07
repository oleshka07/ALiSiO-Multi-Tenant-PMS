'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import ProjectModal, { ProjectFormValues } from './ProjectModal';
import ProjectTreeRow from './ProjectTreeRow';

export interface Project {
  id: string;
  name: string;
  unit_type: string | null;
  parent_id: string | null;
  is_shared: number;
  is_active: number;
  sort_order: number;
}

export interface ProjectNode extends Project {
  children: Project[];
}

interface TreeResponse {
  tree: ProjectNode[];
}

export default function ProjectsTab() {
  const t = useT();
  const [data, setData] = useState<TreeResponse>({ tree: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Project | { parent: Project | null } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/projects/tree');
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Failed to load project tree', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  const filtered = useMemo(() => {
    if (!search.trim()) return data.tree;
    const needle = search.trim().toLowerCase();
    return data.tree
      .map((node) => {
        const matchRoot = node.name.toLowerCase().includes(needle);
        const matchingChildren = node.children.filter((c) => c.name.toLowerCase().includes(needle));
        if (matchRoot || matchingChildren.length > 0) {
          return { ...node, children: matchRoot ? node.children : matchingChildren };
        }
        return null;
      })
      .filter((n): n is ProjectNode => n !== null);
  }, [data.tree, search]);

  async function handleSave(values: ProjectFormValues, existingId?: string) {
    const method = existingId ? 'PATCH' : 'POST';
    const url = existingId ? `/api/finance/projects/${existingId}` : '/api/finance/projects';
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
    fetchTree();
  }

  async function handleDelete(project: Project) {
    if (!confirm(`Видалити проєкт «${project.name}»?`)) return;
    const res = await fetch(`/api/finance/projects/${project.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося видалити');
      return;
    }
    fetchTree();
  }

  async function handleArchiveToggle(project: Project) {
    const willArchive = project.is_active === 1;
    const verb = willArchive ? 'Архівувати' : 'Відновити';
    if (!confirm(`${verb} «${project.name}»?`)) return;
    const res = await fetch(`/api/finance/projects/${project.id}/archive`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: willArchive }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося');
      return;
    }
    fetchTree();
  }

  async function handleMove(draggedId: string, targetParentId: string | null, targetSortOrder?: number) {
    const res = await fetch(`/api/finance/projects/${draggedId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: targetParentId, sort_order: targetSortOrder }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося перемістити');
      return;
    }
    fetchTree();
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{t('Проєкти')}</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {data.tree.length} {t('кореневих')}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setEditing({ parent: null })}
          style={addBtnStyle}
        >
          <Plus size={16} /> {t('Додати проєкт')}
        </button>
      </div>

      <input
        type="text"
        placeholder={t('Пошук проєкту...')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={searchStyle}
      />

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('Завантаження…')}</div>
      ) : filtered.length === 0 ? (
        <div style={emptyStyle}>
          {search ? t('Нічого не знайдено.') : t('Проєктів ще немає. Натисніть «Додати проєкт».')}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          {filtered.map((root) => {
            const isCollapsed = collapsed.has(root.id);
            return (
              <div key={root.id}>
                <ProjectTreeRow
                  project={root}
                  isRoot
                  depth={0}
                  expandedIcon={
                    root.children.length > 0 ? (
                      <button
                        onClick={() => toggleCollapse(root.id)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-secondary)' }}
                        aria-label={isCollapsed ? t('Розгорнути') : t('Згорнути')}
                      >
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                    ) : null
                  }
                  onEdit={() => setEditing(root)}
                  onAddChild={() => setEditing({ parent: root })}
                  onArchiveToggle={() => handleArchiveToggle(root)}
                  onDelete={() => handleDelete(root)}
                  onMove={handleMove}
                />
                {!isCollapsed && root.children.map((child) => (
                  <ProjectTreeRow
                    key={child.id}
                    project={child}
                    isRoot={false}
                    depth={1}
                    onEdit={() => setEditing(child)}
                    onArchiveToggle={() => handleArchiveToggle(child)}
                    onDelete={() => handleDelete(child)}
                    onMove={handleMove}
                    parentId={root.id}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ProjectModal
          initial={'id' in editing ? editing : undefined}
          parent={'parent' in editing ? editing.parent : ('parent_id' in editing && editing.parent_id
            ? data.tree.find((n) => n.id === editing.parent_id) || null
            : null)}
          onClose={() => setEditing(null)}
          onSave={(vals) => handleSave(vals, 'id' in editing ? editing.id : undefined)}
        />
      )}
    </div>
  );
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
