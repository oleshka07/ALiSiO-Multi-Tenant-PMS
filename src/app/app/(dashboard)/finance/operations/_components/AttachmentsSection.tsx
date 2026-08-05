'use client';

import { useT } from '@core/i18n/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, Trash2, FileText, Image as ImageIcon, FileArchive, ExternalLink } from 'lucide-react';

interface Attachment {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

interface Props {
  operationId: string | null; // null when operation is not yet created
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function MimeIcon({ mime }: { mime: string | null }) {
  if (mime?.startsWith('image/')) return <ImageIcon size={14} color="#3b82f6" />;
  if (mime === 'application/pdf') return <FileText size={14} color="#dc2626" />;
  if (mime?.includes('zip') || mime?.includes('compress')) return <FileArchive size={14} color="#a16207" />;
  return <FileText size={14} color="#6b7280" />;
}

export default function AttachmentsSection({ operationId }: Props) {
  const t = useT();
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchItems = useCallback(async () => {
    if (!operationId) { setItems([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/operations/${operationId}/attachments`);
      const json = await res.json();
      setItems(json.items || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [operationId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function handleUpload(file: File) {
    if (!operationId) {
      alert('Спершу збережи операцію — потім зможеш прикріпити файл');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/finance/operations/${operationId}/attachments`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        alert(`Помилка: ${json.error || 'upload failed'}`);
      } else {
        fetchItems();
      }
    } catch (e: any) {
      alert(`Помилка: ${e.message}`);
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Видалити «${name}»?`)) return;
    try {
      const res = await fetch(`/api/finance/attachments/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json();
        alert(`Помилка: ${j.error || 'delete failed'}`);
        return;
      }
      fetchItems();
    } catch (e: any) {
      alert(`Помилка: ${e.message}`);
    }
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Paperclip size={14} color="var(--text-secondary)" />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
          {t('Документи')} {items.length > 0 && `(${items.length})`}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf,application/zip,.xlsx,.xls,.doc,.docx,.csv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
            disabled={uploading || !operationId}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || !operationId}
            style={uploadBtn}
            title={!operationId ? 'Спершу збережи операцію' : 'Прикріпити файл'}
          >
            <Upload size={12} /> {uploading ? 'Завантаження…' : 'Прикріпити'}
          </button>
        </div>
      </div>

      {!operationId ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          {t('Документи доступні після збереження операції')}
        </div>
      ) : loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('Завантаження…')}</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' }}>
          {t('Немає прикріплених документів. Підтримує: фото, PDF, Excel, ZIP (до 25 МБ).')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((a) => (
            <div key={a.id} style={attachRow}>
              <MimeIcon mime={a.mime_type} />
              <a
                href={`/api/finance/attachments/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, color: 'var(--text-primary)', textDecoration: 'none', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
                title={a.file_name}
              >
                {a.file_name}
                <ExternalLink size={10} style={{ opacity: 0.5 }} />
              </a>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtSize(a.size_bytes)}</span>
              {a.uploaded_by_name && (
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{a.uploaded_by_name}</span>
              )}
              <button
                type="button"
                onClick={() => handleDelete(a.id, a.file_name)}
                style={delBtn}
                title={t('Видалити')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const uploadBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
  fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
};
const attachRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 8px', borderRadius: 6,
  background: 'var(--bg-secondary)',
};
const delBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 4,
  cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: 4,
};
