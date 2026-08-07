'use client';

import { useT } from '@core/i18n/client';
import { useState } from 'react';
import { GripVertical, Pencil, Archive, RotateCcw, Trash2, Plus } from 'lucide-react';
import type { Project } from './ProjectsTab';

interface Props {
  project: Project;
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

export default function ProjectTreeRow({
  project,
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
  const [dragOver, setDragOver] = useState<'above' | 'below' | 'onto' | null>(null);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      id: project.id,
      isRoot,
      parentId: parentId || null,
    }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    if (isRoot && ratio > 0.25 && ratio < 0.75) {
      setDragOver('onto');
    } else if (ratio < 0.5) {
      setDragOver('above');
    } else {
      setDragOver('below');
    }
  }

  function handleDragLeave() { setDragOver(null); }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const payload = e.dataTransfer.getData('text/plain');
    if (!payload) { setDragOver(null); return; }
    let data: { id: string; isRoot: boolean; parentId: string | null };
    try { data = JSON.parse(payload); } catch { setDragOver(null); return; }
    if (data.id === project.id) { setDragOver(null); return; }

    if (dragOver === 'onto' && isRoot) {
      onMove(data.id, project.id);
    } else if (dragOver === 'above') {
      onMove(data.id, isRoot ? null : (parentId || null), Math.max(0, project.sort_order - 1));
    } else if (dragOver === 'below') {
      onMove(data.id, isRoot ? null : (parentId || null), project.sort_order + 1);
    }
    setDragOver(null);
  }

  const dragOverStyle: React.CSSProperties =
    dragOver === 'above' ? { borderTop: '2px solid var(--accent, #6366f1)' } :
    dragOver === 'below' ? { borderBottom: '2px solid var(--accent, #6366f1)' } :
    dragOver === 'onto' ? { background: 'rgba(99,102,241,0.12)' } : {};

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
        opacity: project.is_active ? 1 : 0.5,
        transition: 'background 0.1s',
        ...dragOverStyle,
      }}
    >
      <GripVertical size={14} style={{ color: 'var(--text-secondary)', cursor: 'grab', flexShrink: 0 }} />
      {expandedIcon !== undefined ? expandedIcon : <span style={{ width: 20 }} />}

      <span style={{ fontWeight: isRoot ? 600 : 400, flex: 1, minWidth: 0 }}>
        {project.name}
        {project.unit_type && project.unit_type !== project.name && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 8 }}>
            {project.unit_type}
          </span>
        )}
        {!project.is_active && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 6 }}>{t('(архів)')}</span>
        )}
      </span>

      {project.is_shared === 1 && <Badge>{t('Спільний')}</Badge>}

      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {isRoot && onAddChild && (
          <button
            onClick={onAddChild}
            style={{ ...iconBtnStyle, color: 'var(--accent, #6366f1)' }}
            title={t('Додати підпроєкт')}
          >
            <Plus size={15} />
          </button>
        )}
        <button onClick={onEdit} style={iconBtnStyle} title={t('Редагувати')}><Pencil size={14} /></button>
        <button onClick={onArchiveToggle} style={iconBtnStyle} title={project.is_active ? t('Архівувати') : t('Відновити')}>
          {project.is_active ? <Archive size={14} /> : <RotateCcw size={14} />}
        </button>
        <button onClick={onDelete} style={{ ...iconBtnStyle, color: '#dc2626' }} title={t('Видалити')}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
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
