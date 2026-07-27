'use client';

import { useState } from 'react';
import { Database, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';

interface SectionResult {
  parsed: number; created: number; skipped: number; errors: string[];
  unmatched_properties?: string[];
}
interface ImportResult {
  ok: boolean; dry_run: boolean;
  properties: SectionResult; investors: SectionResult; investments: SectionResult;
  payments: SectionResult; metrics: SectionResult;
}

export default function SupabaseImportTab() {
  const [files, setFiles] = useState<{ properties?: File; investors?: File; investments?: File; payments?: File; metrics?: File }>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    if (!files.properties && !files.investors && !files.investments && !files.payments && !files.metrics) {
      alert('Хоча б один файл потрібен');
      return;
    }
    setRunning(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      if (files.properties)  fd.append('properties_csv',  files.properties);
      if (files.investors)   fd.append('investors_csv',   files.investors);
      if (files.investments) fd.append('investments_csv', files.investments);
      if (files.payments)    fd.append('payments_csv',    files.payments);
      if (files.metrics)     fd.append('metrics_csv',     files.metrics);
      const res = await fetch(`/api/finance/investors/import-supabase${dryRun ? '?dry_run=1' : ''}`, {
        method: 'POST', body: fd,
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Import failed'); }
      else setResult(json);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Database size={20} color="#3b82f6" />
        <h2 style={{ margin: 0, fontSize: 18 }}>Import з Supabase (InvestFlow)</h2>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Експортуй кожну таблицю з Supabase Dashboard → Table Editor → Export → CSV.
        Завантаж сюди — система автоматично змапить колонки, прив&apos;яже інвесторів і property-имена,
        та створить локальні entities. <b>Idempotent</b> — повторний upload не створює дублі (matched by supabase_id).
      </p>

      <div style={{ padding: 12, marginBottom: 16, background: 'rgba(245,158,11,0.08)', border: '1px solid #f59e0b', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' }}>
        ⚠️ <b>Завантажуй усі 5 файлів разом</b> — порядок обробки фіксований (properties → investors → investments → payments → metrics)
        і всі ID-зв&apos;язки розв&apos;язуються в одній транзакції. Properties → створюються нові business_units (або матчаться по name)
        + імпортуються work_stages JSON. Решта файлів використовують <code>property_id</code> з Supabase.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
        <FileSlot label="1. properties.csv" file={files.properties} onChange={(f) => setFiles({ ...files, properties: f })} />
        <FileSlot label="2. investors.csv" file={files.investors} onChange={(f) => setFiles({ ...files, investors: f })} />
        <FileSlot label="3. investments.csv" file={files.investments} onChange={(f) => setFiles({ ...files, investments: f })} />
        <FileSlot label="4. payments.csv" file={files.payments} onChange={(f) => setFiles({ ...files, payments: f })} />
        <FileSlot label="5. metrics.csv" file={files.metrics} onChange={(f) => setFiles({ ...files, metrics: f })} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => run(true)} disabled={running} style={btn}>🔍 Dry-run (preview)</button>
        <button onClick={() => run(false)} disabled={running} style={{ ...btn, background: '#3b82f6', color: '#fff', border: 'none' }}>
          {running ? 'Імпорт…' : '✓ Запустити імпорт'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
          <b>Помилка:</b> {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--border-primary)', borderRadius: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {result.dry_run ? '🔍 Dry-run результат' : '✓ Імпорт виконано'}
          </div>

          {(['properties', 'investors', 'investments', 'payments', 'metrics'] as const).map((section) => {
            const r = result[section];
            if (r.parsed === 0 && r.errors.length === 0) return null;
            return (
              <div key={section} style={{ marginBottom: 12, padding: 10, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <div style={{ fontWeight: 600, textTransform: 'capitalize', marginBottom: 4 }}>{section}</div>
                <div style={{ fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>Parsed: <b>{r.parsed}</b></span>
                  <span style={{ color: '#22c55e' }}>{result.dry_run ? 'Will create' : 'Created'}: <b>{r.created}</b></span>
                  <span style={{ color: 'var(--text-secondary)' }}>Skipped (already imported): <b>{r.skipped}</b></span>
                  {r.errors.length > 0 && (
                    <span style={{ color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <AlertCircle size={12} /> Errors: <b>{r.errors.length}</b>
                    </span>
                  )}
                </div>
                {r.unmatched_properties && r.unmatched_properties.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#f59e0b' }}>
                    Не знайдено properties: {r.unmatched_properties.join(', ')}
                  </div>
                )}
                {r.errors.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#ef4444' }}>Show errors ({r.errors.length})</summary>
                    <ul style={{ margin: '4px 0 0 16px', fontSize: 11, color: 'var(--text-secondary)' }}>
                      {r.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                      {r.errors.length > 20 && <li>... + {r.errors.length - 20} more</li>}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FileSlot({ label, file, onChange }: { label: string; file?: File; onChange: (f: File | undefined) => void }) {
  return (
    <div style={{ padding: 12, border: file ? '2px solid #22c55e' : '1px dashed var(--border-primary)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <input type="file" accept=".csv" onChange={(e) => onChange(e.target.files?.[0])} style={{ fontSize: 12 }} />
      {file && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
          <CheckCircle2 size={12} /> {file.name} ({(file.size / 1024).toFixed(1)} KB)
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 16px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer' };
