'use client';

import { useT } from '@core/i18n/client';import { useState } from 'react';
import { Upload, Loader2, X } from 'lucide-react';

async function uploadImage(file: File, folder: string): Promise<string | null> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);
  try {
    const res = await fetch('/api/file-upload', { method: 'POST', body: formData });
    if (res.ok) return (await res.json()).url;
    return null;
  } catch { return null; }
}

interface ImageUploadFieldProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  folder: string;
  /** Preview aspect ratio, default '16/9' */
  aspectRatio?: '16/9' | '4/3' | '1/1' | '3/1';
  placeholder?: string;
}

export function ImageUploadField({ label, value, onChange, folder, aspectRatio = '16/9', placeholder }: ImageUploadFieldProps) {
  const t = useT();
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadImage(file, folder);
    if (url) onChange(url);
    setUploading(false);
    e.target.value = '';
  };

  // Compute padding-top for aspect ratio
  const paddingMap: Record<string, string> = {
    '16/9': '56.25%', '4/3': '75%', '1/1': '100%', '3/1': '33.33%',
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="form-input"
          style={{ flex: 1 }}
          value={value}
          placeholder={placeholder || t('https://... або завантажте файл')}
          onChange={e => onChange(e.target.value)}
        />
        <label style={{
          padding: '8px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
          background: 'var(--accent-primary)', color: '#fff', fontSize: 13, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {uploading ? <Loader2 size={14} className="animate-pulse" /> : <Upload size={14} />}
          {uploading ? '...' : t('Завантажити')}
          <input type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
        </label>
      </div>

      {value && (
        <div style={{ marginTop: 8, borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative', border: '1px solid var(--border-primary)' }}>
          <div style={{ paddingTop: paddingMap[aspectRatio] || '56.25%', position: 'relative' }}>
            <img
              src={value} alt="Preview"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange('')}
            style={{
              position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)',
              border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
