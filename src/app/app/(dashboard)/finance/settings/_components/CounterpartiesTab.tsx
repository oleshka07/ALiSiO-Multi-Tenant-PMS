'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import CounterpartyModal, { CounterpartyFormValues } from './CounterpartyModal';
import CounterpartyTreeRow from './CounterpartyTreeRow';
import { usePropertyScope } from '@/ui/PropertyScopeContext';

export type Kind = 'client' | 'supplier' | 'employee' | 'other';

export interface Counterparty {
  id: string;
  name: string;
  parent_id: string | null;
  kind: Kind | null;
  note: string | null;
  aliases: string[];
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_active: number;
}

export interface CounterpartyNode extends Counterparty {
  children: Counterparty[];
}

interface TreeResponse {
  tree: CounterpartyNode[];
  byKind: Record<string, CounterpartyNode[]>;
}

const KIND_FILTER_TABS: { id: Kind | 'all' | 'unspecified'; label: string; emoji: string }[] = [
  { id: 'all',         label: 'Усі',           emoji: '👥' },
  { id: 'client',      label: 'Клієнти',       emoji: '🤝' },
  { id: 'supplier',    label: 'Постачальники', emoji: '🏪' },
  { id: 'employee',    label: 'Співробітники', emoji: '👷' },
  { id: 'other',       label: 'Інше',          emoji: '📋' },
  { id: 'unspecified', label: 'Без типу',      emoji: '❓' },
];

export default function CounterpartiesTab() {
  // Обʼєкт із перемикача в шапці (INC-038, Д54): довідники фінансів належать
  // БУДИНКУ — два обʼєкти під одним рахунком ведуть дві бухгалтерії. `?? 'all'`
  // — це СКАЗАНЕ «усі обʼєкти», а не мовчання: на мовчання маршрут відповідає
  // 400, і це навмисно (інваріант 8).
  const { propertyId } = usePropertyScope();
  const scopeParam = propertyId ?? 'all';

  const tUi = useT();
  const [data, setData] = useState<TreeResponse>({ tree: [], byKind: {} });
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<Kind | 'all' | 'unspecified'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Counterparty | { parent: CounterpartyNode | null } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/counterparties/tree?property_id=${encodeURIComponent(scopeParam)}`);
      const json = await res.json();
      setData(json?.tree ? json : { tree: [], byKind: {} });
    } catch (e) {
      console.error('Failed to load counterparty tree', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  const visibleNodes = useMemo(() => {
    const source = kindFilter === 'all' ? data.tree : (data.byKind[kindFilter] || []);
    if (!search.trim()) return source;
    const needle = search.trim().toLowerCase();
    return source
      .map((node) => {
        const matchRoot = node.name.toLowerCase().includes(needle)
          || node.aliases.some((a) => a.toLowerCase().includes(needle));
        const matchingChildren = node.children.filter((c) =>
          c.name.toLowerCase().includes(needle)
          || c.aliases.some((a) => a.toLowerCase().includes(needle))
        );
        if (matchRoot || matchingChildren.length > 0) {
          return { ...node, children: matchRoot ? node.children : matchingChildren };
        }
        return null;
      })
      .filter((n): n is CounterpartyNode => n !== null);
  }, [data, kindFilter, search]);

  async function handleSave(values: CounterpartyFormValues, existingId?: string) {
    const method = existingId ? 'PATCH' : 'POST';
    const url = existingId
      ? `/api/finance/counterparties/${existingId}`
      : `/api/finance/counterparties?property_id=${encodeURIComponent(scopeParam)}`;
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

  async function handleDelete(cp: Counterparty) {
    if (!confirm(`Видалити контрагента «${cp.name}»?`)) return;
    const res = await fetch(`/api/finance/counterparties/${cp.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Не вдалося видалити');
      return;
    }
    fetchTree();
  }

  async function handleArchiveToggle(cp: Counterparty) {
    const willArchive = cp.is_active === 1;
    const verb = willArchive ? 'Архівувати' : 'Відновити';
    if (!confirm(`${verb} «${cp.name}»?`)) return;
    const res = await fetch(`/api/finance/counterparties/${cp.id}/archive`, {
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
    const res = await fetch(`/api/finance/counterparties/${draggedId}/move`, {
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

  const totalActive = data.tree.length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{tUi('Контрагенти')}</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {totalActive} {tUi('кореневих')}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditing({ parent: null })} style={addBtnStyle}>
          <Plus size={16} /> {tUi('Додати контрагента')}
        </button>
      </div>

      <div style={tabsStripStyle}>
        {KIND_FILTER_TABS.map((t) => {
          const isActive = kindFilter === t.id;
          const count = t.id === 'all' ? data.tree.length : (data.byKind[t.id] || []).length;
          return (
            <button
              key={t.id}
              onClick={() => setKindFilter(t.id)}
              style={{
                ...tabBtnStyle,
                background: isActive ? 'var(--bg-primary)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 500,
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <span>{tUi(t.emoji)}</span>
              <span>{tUi(t.label)}</span>
              <span style={badgeStyle}>{count}</span>
            </button>
          );
        })}
      </div>

      <input
        type="text"
        placeholder={tUi('Пошук контрагента або синоніма...')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={searchStyle}
      />

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{tUi('Завантаження…')}</div>
      ) : visibleNodes.length === 0 ? (
        <div style={emptyStyle}>
          {search ? tUi('Нічого не знайдено.') : tUi('Контрагентів ще немає. Натисніть «Додати контрагента».')}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
          {visibleNodes.map((root) => {
            const isCollapsed = collapsed.has(root.id);
            return (
              <div key={root.id}>
                <CounterpartyTreeRow
                  counterparty={root}
                  isRoot
                  depth={0}
                  expandedIcon={
                    root.children.length > 0 ? (
                      <button
                        onClick={() => toggleCollapse(root.id)}
                        style={chevBtn}
                        aria-label={isCollapsed ? tUi('Розгорнути') : tUi('Згорнути')}
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
                  <CounterpartyTreeRow
                    key={child.id}
                    counterparty={child}
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
        <CounterpartyModal
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
const tabsStripStyle: React.CSSProperties = {
  display: 'flex', gap: 4, padding: 3, background: 'var(--bg-secondary)',
  borderRadius: 10, border: '1px solid var(--border-primary)',
  marginBottom: 12, flexWrap: 'wrap',
};
const tabBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  border: 'none', fontSize: 12, cursor: 'pointer', borderRadius: 8,
  transition: 'all 0.15s',
};
const badgeStyle: React.CSSProperties = {
  marginLeft: 4, fontSize: 10, padding: '1px 6px', borderRadius: 4,
  background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
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
const chevBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  padding: 2, color: 'var(--text-secondary)',
};
