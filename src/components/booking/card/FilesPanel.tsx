'use client';

/**
 * Вкладка «Файли» картки броні (Блок 4, 0090): скани, підтвердження, фото.
 *
 * Список — `GET /api/bookings/[id]/files`, завантаження — `POST` тим самим
 * маршрутом (multipart), видалення — `DELETE …/files/[fileId]`. Файл
 * відкривається за своєю адресою `/api/uploads/<org>/…`, яку звіряє сервер.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@core/i18n/client';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/State';
import { Paperclip, Upload, Trash2, ExternalLink, Loader2 } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  bookingId: string;
  showToast: (msg: string) => void;
  /** Змінився список — батько може оновити лічильник на вкладці. */
  onCountChange?: (n: number) => void;
}

const KINDS = ['document', 'photo', 'other'] as const;

function sizeLabel(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesPanel({ bookingId, showToast, onCountChange }: Props) {
  const tUi = useT();
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('document');
  const inputRef = useRef<HTMLInputElement>(null);

  const kindLabel = (k: string) => ({ document: tUi('Документ'), photo: tUi('Фото'), other: tUi('Інше') } as Record<string, string>)[k] || k;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${bookingId}/files`);
      if (!res.ok) { setFailed(true); return; }
      const data = await res.json();
      const list = Array.isArray(data.files) ? data.files : [];
      setFiles(list);
      onCountChange?.(list.length);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [bookingId, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const res = await fetch(`/api/bookings/${bookingId}/files`, { method: 'POST', body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const why = data?.error === 'unsupported_type' ? tUi('Такий тип файла не приймається: JPG, PNG, WebP, HEIC або PDF')
          : data?.error === 'file_too_large' ? tUi('Файл завеликий — до 10 МБ')
          : tUi('Не вдалося завантажити файл');
        showToast(`❌ ${why}`);
        return;
      }
      await load();
      showToast(tUi('✅ Файл додано'));
    } catch { showToast(`❌ ${tUi('Не вдалося завантажити файл')}`); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const remove = async (f: any) => {
    if (!confirm(`${tUi('Видалити файл')} «${f.original_name}»?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/files/${f.id}`, { method: 'DELETE' });
      if (!res.ok) { showToast(`❌ ${tUi('Не вдалося видалити файл')}`); return; }
      await load();
    } finally { setBusy(false); }
  };

  const picker = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select className="form-select" value={kind} style={{ width: 'auto', fontSize: 12 }} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
        {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
      </select>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 size={12} className="animate-pulse" /> : <Upload size={12} />} {tUi('Завантажити файл')}
      </button>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{tUi('JPG, PNG, WebP, HEIC, PDF — до 10 МБ')}</span>
    </div>
  );

  if (loading) return <LoadingState compact />;
  if (failed) return <ErrorState retry={() => { setLoading(true); load(); }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {picker}
      {files.length === 0 ? (
        <EmptyState compact icon={<Paperclip size={22} />}
          title={tUi('Файлів ще немає')}
          hint={tUi('Скан документа, підтвердження оплати чи фото — лишаються при броні і видні всій рецепції.')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)' }}>
              <Paperclip size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="badge badge-info" style={{ fontSize: 10 }}>{kindLabel(f.kind)}</span>
                  {f.size_bytes ? <span>{sizeLabel(Number(f.size_bytes))}</span> : null}
                  <span>{String(f.created_at).slice(0, 10)}</span>
                  {f.uploaded_by_name && <span>{f.uploaded_by_name}</span>}
                </div>
              </div>
              <a className="btn btn-sm btn-ghost" href={f.path} target="_blank" rel="noopener" title={tUi('Відкрити')}><ExternalLink size={13} /></a>
              <button className="btn btn-sm btn-ghost" style={{ color: 'var(--accent-danger)' }} disabled={busy} onClick={() => remove(f)} title={tUi('Видалити')}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
