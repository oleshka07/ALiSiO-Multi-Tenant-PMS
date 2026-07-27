'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';

interface Props {
  endpoint: string;
  params: Record<string, string | number | undefined | null>;
  label?: string;
}

function buildUrl(endpoint: string, params: Props['params'], format: 'xlsx' | 'pdf'): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  qs.set('format', format);
  return `${endpoint}?${qs.toString()}`;
}

export default function ExportButton({ endpoint, params, label = 'Експорт' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', border: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)', color: 'var(--text-primary)',
          borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
        }}
        title="Експортувати дані"
      >
        <Download size={14} /> {label}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
            borderRadius: 8, padding: 4, minWidth: 140,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 50,
          }}
        >
          <a
            href={buildUrl(endpoint, params, 'xlsx')}
            onClick={() => setOpen(false)}
            style={menuItem}
          >
            <FileSpreadsheet size={14} color="#16a34a" /> XLSX (Excel)
          </a>
          <a
            href={buildUrl(endpoint, params, 'pdf')}
            onClick={() => setOpen(false)}
            style={menuItem}
          >
            <FileText size={14} color="#dc2626" /> PDF
          </a>
        </div>
      )}
    </div>
  );
}

const menuItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 12px', borderRadius: 6,
  fontSize: 13, color: 'var(--text-primary)',
  textDecoration: 'none', cursor: 'pointer',
};
