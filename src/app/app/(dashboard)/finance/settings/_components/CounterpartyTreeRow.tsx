'use client';

import { useT, usePlural } from '@core/i18n/client';
import { useState } from 'react';
import { GripVertical, Pencil, Archive, RotateCcw, Trash2, Plus } from 'lucide-react';
import type { Counterparty, Kind } from './CounterpartiesTab';

interface Props {
  counterparty: Counterparty;
  isRoot: boolean;
  depth: number;
  expandedIcon?: React.ReactNode;
  parentId?: string;
  onEdit: () => void;
  onAddChild?: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onMove: (draggedId: string, targetParentId: string | null, targetSortOrder?: number) => void;
}

const KIND_LABELS: Record<Kind, string> = {
  client: 'Клієнт',
  supplier: 'Постачальник',
  employee: 'Співробітник',
  other: 'Інше',
};

export default function CounterpartyTreeRow({
  counterparty,
  isRoot,
  depth,
  expandedIcon,
  parentId,
  onEdit,
  onAddChild,
  onArchiveToggle,
  onDelete,
  onMove,
}: Props) {
  const t = useT();
  const plural = usePlural();
  const [dragOver, setDragOver] = useState<'above' | 'below' | 'onto' | null>(null);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      id: counterparty.id,
      isRoot,
      parentId: parentId || null,
      kind: counterparty.kind,
    }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    if (isRoot && ratio > 0.25 && ratio < 0.75) setDragOver('onto');
    else if (ratio < 0.5) setDragOver('above');
    else setDragOver('below');
  }

  function handleDragLeave() { setDragOver(null); }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const payload = e.dataTransfer.getData('text/plain');
    if (!payload) { setDragOver(null); return; }
    let data: { id: string; isRoot: boolean; parentId: string | null; kind: Kind | null };
    try { data = JSON.parse(payload); } catch { setDragOver(null); return; }
    if (data.id === counterparty.id) { setDragOver(null); return; }
    if (data.kind !== counterparty.kind) {
      alert(t('Не можна переміщувати між різними типами контрагентів.'));
      setDragOver(null);
      return;
    }
    if (dragOver === 'onto' && isRoot) {
      onMove(data.id, counterparty.id);
    } else if (dragOver === 'above') {
      onMove(data.id, isRoot ? null : (parentId || null), Math.max(0, counterparty.sort_order - 1));
    } else if (dragOver === 'below') {
      onMove(data.id, isRoot ? null : (parentId || null), counterparty.sort_order + 1);
    }
    setDragOver(null);
  }

  const dragOverStyle: React.CSSProperties =
    dragOver === 'above' ? { borderTop: '2px solid var(--accent, #6366f1)' } :
    dragOver === 'below' ? { borderBottom: '2px solid var(--accent, #6366f1)' } :
    dragOver === 'onto' ? { background: 'rgba(99,102,241,0.12)' } : {};

  const aliasCount = counterparty.aliases.length;

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        paddingLeft: 12 + depth * 28,
        borderTop: depth === 0 ? 'none' : '1px solid var(--border-primary)',
        background: depth === 0 ? 'var(--bg-secondary)' : 'transparent',
        opacity: counterparty.is_active ? 1 : 0.5,
        transition: 'background 0.1s',
        ...dragOverStyle,
      }}
    >
      <GripVertical size={14} style={{ color: 'var(--text-secondary)', cursor: 'grab', flexShrink: 0 }} />
      {expandedIcon !== undefined ? expandedIcon : <span style={{ width: 20 }} />}

      {counterparty.icon && <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{counterparty.icon}</span>}
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: 2,
        background: counterparty.color || '#6b7280', flexShrink: 0,
      }} />

      <span style={{ fontWeight: isRoot ? 600 : 400, flex: 1, minWidth: 0 }}>
        {counterparty.name}
        {!counterparty.is_active && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 6 }}>{t('(архів)')}</span>
        )}
      </span>

      {isRoot && counterparty.kind && <Badge>{t(KIND_LABELS[counterparty.kind])}</Badge>}
      {aliasCount > 0 && (
        <Badge title={counterparty.aliases.join(', ')}>
          {aliasCount} {plural(aliasCount, 'синонім')}
        </Badge>
      )}

      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {isRoot && onAddChild && (
          <button onClick={onAddChild} style={{ ...iconBtnStyle, color: 'var(--accent, #6366f1)' }} title={t('Додати підконтрагента')}>
            <Plus size={15} />
          </button>
        )}
        <button onClick={onEdit} style={iconBtnStyle} title={t('Редагувати')}><Pencil size={14} /></button>
        <button onClick={onArchiveToggle} style={iconBtnStyle} title={counterparty.is_active ? t('Архівувати') : t('Відновити')}>
          {counterparty.is_active ? <Archive size={14} /> : <RotateCcw size={14} />}
        </button>
        <button onClick={onDelete} style={{ ...iconBtnStyle, color: '#dc2626' }} title={t('Видалити')}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 4,
        background: 'var(--bg-primary)',
        color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 6, cursor: 'pointer',
  color: 'var(--text-secondary)', borderRadius: 6,
};
