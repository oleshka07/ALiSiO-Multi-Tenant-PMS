'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, FileSpreadsheet, ArrowRight, Save, Trash2, History, CheckCircle2, AlertCircle } from 'lucide-react';

interface ParseResult {
  ok: boolean;
  file_name: string;
  headers: string[];
  sample_rows: any[][];
  row_count: number;
  signature: string;
  matched_format: { id: string; name: string; description: string | null } | null;
  suggested_mapping: Record<number, string>;
  supported_fields: string[];
  all_rows: any[][];
}

interface SavedFormat {
  id: string;
  name: string;
  description: string | null;
  detector_signature: string;
  field_mappings: Record<number, string>;
  updated_at: string;
}

interface RunHistory {
  id: string;
  format_name: string | null;
  file_name: string;
  rows_total: number;
  rows_created: number;
  rows_skipped: number;
  rows_dup: number;
  status: string;
  created_at: string;
}

type RowStatus = 'ok' | 'possible_dup' | 'exact_dup' | 'error';

interface ProcessedRow {
  index: number;
  status: RowStatus;
  paid_at: string | null;
  amount: number;
  currency: string;
  op_type: 'income' | 'expense' | 'transfer' | null;
  account_from: { source: string; resolved_id: string | null; action: string } | null;
  account_to:   { source: string; resolved_id: string | null; action: string } | null;
  category:     { source: string; resolved_id: string | null; action: string } | null;
  project:      { source: string; resolved_id: string | null; action: string } | null;
  counterparty: { source: string; resolved_id: string | null; action: string } | null;
  comment: string | null;
  error: string | null;
  duplicate_candidates: Array<{ id: string; paid_at: string; amount: number; comment: string | null; source: string }>;
}

interface ReviewResult {
  ok: boolean;
  rows: ProcessedRow[];
  summary: { total: number; ok: number; possible_dup: number; exact_dup: number; errors: number };
  all_entities: {
    category: { id: string; name: string; meta?: string }[];
    project:  { id: string; name: string; meta?: string }[];
  };
}

type EntityType = 'account' | 'category' | 'project' | 'counterparty';
const ENTITY_LABELS: Record<EntityType, string> = {
  account: 'Рахунки', category: 'Категорії', project: 'Проєкти', counterparty: 'Контрагенти',
};

interface PmsEntity { id: string; name: string; meta?: string; similarity?: number }
interface EntityCandidate {
  source_value: string;
  candidates: PmsEntity[];
  exact_match: PmsEntity | null;
  saved_resolution: { entity_id: string | null; action: string } | null;
}
interface ResolutionResult {
  ok: boolean;
  resolutions: Record<EntityType, { source_values_count: number; items: EntityCandidate[] }>;
}

interface UserChoice {
  pms_entity_id: string | null;
  action: 'use_existing' | 'create_new' | 'ignore';
}

export default function ImportWizardPage() {
  const [stage, setStage] = useState<'upload' | 'mapping' | 'resolution' | 'review'>('upload');
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [approvedIndices, setApprovedIndices] = useState<Set<number>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [formatId, setFormatId] = useState<string | null>(null);
  const [formatName, setFormatName] = useState('');
  const [formatDesc, setFormatDesc] = useState('');
  const [savedFormats, setSavedFormats] = useState<SavedFormat[]>([]);
  const [runs, setRuns] = useState<RunHistory[]>([]);
  const [resolution, setResolution] = useState<ResolutionResult | null>(null);
  const [choices, setChoices] = useState<Record<EntityType, Record<string, UserChoice>>>({ account: {}, category: {}, project: {}, counterparty: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAuxiliary = useCallback(async () => {
    try {
      const [fRes, rRes] = await Promise.all([
        fetch('/api/finance/import/formats'),
        fetch('/api/finance/import/runs'),
      ]);
      const [fJ, rJ] = await Promise.all([fRes.json(), rRes.json()]);
      setSavedFormats(fJ.items || []);
      setRuns(rJ.items || []);
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { fetchAuxiliary(); }, [fetchAuxiliary]);

  async function handleUpload(file: File) {
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/finance/import/parse', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Parse failed'); setLoading(false); return; }
      setParsed(json);
      setMapping(json.suggested_mapping || {});
      setFormatName(json.matched_format?.name || file.name.replace(/\.[^.]+$/, ''));
      setFormatDesc(json.matched_format?.description || '');
      setStage('mapping');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function saveAndContinue() {
    if (!parsed) return;
    if (!formatName.trim()) { alert('Введи назву формату'); return; }
    setLoading(true); setError(null);
    try {
      const fmtRes = await fetch('/api/finance/import/formats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: parsed.matched_format?.id,
          name: formatName.trim(),
          description: formatDesc.trim() || null,
          signature: parsed.signature,
          field_mappings: mapping,
        }),
      });
      const fmtJson = await fmtRes.json();
      if (!fmtRes.ok) { setError(fmtJson.error || 'Save failed'); setLoading(false); return; }
      const savedId = fmtJson.id as string;
      setFormatId(savedId);

      const resRes = await fetch('/api/finance/import/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format_id: savedId, field_mappings: mapping, all_rows: parsed.all_rows }),
      });
      const resJson = await resRes.json() as ResolutionResult;
      if (!resRes.ok) { setError((resJson as any).error || 'Resolve failed'); setLoading(false); return; }
      setResolution(resJson);

      // Pre-populate choices: saved → exact → high-similarity → create_new
      const initial: Record<EntityType, Record<string, UserChoice>> = { account: {}, category: {}, project: {}, counterparty: {} };
      for (const et of Object.keys(resJson.resolutions) as EntityType[]) {
        for (const item of resJson.resolutions[et].items) {
          if (item.saved_resolution) {
            initial[et][item.source_value] = { pms_entity_id: item.saved_resolution.entity_id, action: item.saved_resolution.action as any };
          } else if (item.exact_match) {
            initial[et][item.source_value] = { pms_entity_id: item.exact_match.id, action: 'use_existing' };
          } else if (item.candidates[0] && (item.candidates[0].similarity || 0) >= 0.85) {
            initial[et][item.source_value] = { pms_entity_id: item.candidates[0].id, action: 'use_existing' };
          } else {
            initial[et][item.source_value] = { pms_entity_id: null, action: 'create_new' };
          }
        }
      }
      setChoices(initial);

      setStage('resolution');
      fetchAuxiliary();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function saveResolutionsAndContinue() {
    if (!formatId || !resolution || !parsed) return;
    setLoading(true); setError(null);
    try {
      const payload: any = { format_id: formatId, resolutions: {} };
      for (const et of Object.keys(choices) as EntityType[]) {
        payload.resolutions[et] = Object.entries(choices[et]).map(([sv, c]) => ({
          source_value: sv, pms_entity_id: c.pms_entity_id, action: c.action,
        }));
      }
      const sRes = await fetch('/api/finance/import/save-resolutions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const sJson = await sRes.json();
      if (!sRes.ok) { setError(sJson.error || 'Save failed'); setLoading(false); return; }

      const rRes = await fetch('/api/finance/import/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format_id: formatId, field_mappings: mapping, all_rows: parsed.all_rows }),
      });
      const rJson = await rRes.json() as ReviewResult;
      if (!rRes.ok) { setError((rJson as any).error || 'Review failed'); setLoading(false); return; }
      setReview(rJson);
      // Default approve: ok + possible_dup, skip exact_dup + error
      const initial = new Set<number>();
      for (const row of rJson.rows) {
        if (row.status === 'ok' || row.status === 'possible_dup') initial.add(row.index);
      }
      setApprovedIndices(initial);
      setStage('review');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  function updateRowField(rowIndex: number, field: 'category' | 'project', next: ProcessedRow['category']) {
    if (!review) return;
    setReview({
      ...review,
      rows: review.rows.map((r) => r.index === rowIndex ? { ...r, [field]: next } : r),
    });
  }

  async function commitFinal() {
    if (!review || !formatId || !parsed) return;
    if (approvedIndices.size === 0) { alert('Не вибрано жодного рядка для імпорту'); return; }
    if (!confirm(`Створити ${approvedIndices.size} fin_operations? Дія НЕ скасовується через цю UI (можна потім видалити вручну за фільтром source = wizard_import).`)) return;
    setCommitting(true); setError(null);
    try {
      const approved = review.rows.filter((r) => approvedIndices.has(r.index));
      const res = await fetch('/api/finance/import/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format_id: formatId, file_name: parsed.file_name, approved_rows: approved }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Commit failed'); setCommitting(false); return; }
      setCommitResult(json);
      fetchAuxiliary();
    } catch (e: any) { setError(e.message); }
    setCommitting(false);
  }

  function backToUpload() {
    setStage('upload');
    setParsed(null);
    setMapping({});
  }

  return (
    <div className="page-container" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/app/finance" style={backLink}><ArrowLeft size={14} /></Link>
        <h1 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileSpreadsheet size={24} /> Import Wizard
        </h1>
      </div>

      <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
        Завантаж XLSX/CSV (Finmap, Booking, Airbnb, бух. звіт — будь-який формат).
        Wizard визначить колонки, дозволить тобі вибрати які саме поля з PMS вони відповідають,
        і збереже мапінг для повторного використання. Стейджі 2 (entity resolution) і 3 (row review)
        — будуть у наступних PR.
      </p>

      {/* STAGE INDICATOR */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, marginBottom: 24 }}>
        <Stage n={1} label="Upload + Field mapping" active={stage === 'upload' || stage === 'mapping'} done={stage === 'resolution' || stage === 'review'} />
        <Stage n={2} label="Entity resolution" active={stage === 'resolution'} done={stage === 'review'} disabled={stage === 'upload'} />
        <Stage n={3} label="Row review + Commit" active={stage === 'review'} done={!!commitResult} disabled={stage !== 'review'} />
      </div>

      {error && (
        <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
          <b>Помилка:</b> {error}
        </div>
      )}

      {/* UPLOAD STAGE */}
      {stage === 'upload' && (
        <>
          <div style={{ padding: 24, border: '2px dashed var(--border-primary)', borderRadius: 12, textAlign: 'center', background: 'var(--bg-secondary)' }}>
            <Upload size={32} color="var(--text-secondary)" />
            <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>Перетягни файл сюди або вибери</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>XLSX, XLS, CSV — до 20 MB</div>
            <input
              type="file" accept=".xlsx,.xls,.csv" disabled={loading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
              style={{ marginTop: 12 }}
            />
          </div>

          {/* Saved formats list */}
          <h3 style={{ marginTop: 32, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Save size={16} /> Збережені формати ({savedFormats.length})
          </h3>
          {savedFormats.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Поки немає. Завантаж файл — після мапінгу формат збережеться для повторного використання.</p>
          ) : (
            <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={th}>Назва</th><th style={th}>Опис</th>
                  <th style={th}>Колонки змаплено</th>
                  <th style={th}>Оновлено</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {savedFormats.map((f) => (
                    <tr key={f.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                      <td style={{ ...td, fontWeight: 600 }}>{f.name}</td>
                      <td style={{ ...td, color: 'var(--text-secondary)', fontSize: 12 }}>{f.description || '—'}</td>
                      <td style={td}>{Object.keys(f.field_mappings).length}</td>
                      <td style={{ ...td, fontSize: 11, color: 'var(--text-secondary)' }}>{f.updated_at}</td>
                      <td style={td}>
                        <button onClick={async () => {
                          if (!confirm(`Видалити формат "${f.name}"?`)) return;
                          await fetch(`/api/finance/import/formats/${f.id}`, { method: 'DELETE' });
                          fetchAuxiliary();
                        }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#dc2626' }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent runs */}
          {runs.length > 0 && (
            <details style={{ marginTop: 24 }}>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <History size={14} /> Останні імпорти ({runs.length})
              </summary>
              <table style={{ width: '100%', marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Дата</th><th style={th}>Формат</th><th style={th}>Файл</th><th style={th}>Створено</th><th style={th}>Skipped</th><th style={th}>Dup</th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border-primary)' }}>
                      <td style={td}>{r.created_at?.substring(0, 16)}</td>
                      <td style={td}>{r.format_name || '—'}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.file_name}</td>
                      <td style={td}>{r.rows_created}</td>
                      <td style={td}>{r.rows_skipped}</td>
                      <td style={td}>{r.rows_dup}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      {/* MAPPING STAGE */}
      {stage === 'mapping' && parsed && (
        <>
          <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>Файл:</b> {parsed.file_name} · <b>Колонок:</b> {parsed.headers.length} · <b>Рядків:</b> {parsed.row_count}
              </div>
              <button onClick={backToUpload} style={btn}>← Назад до upload</button>
            </div>
            {parsed.matched_format && (
              <div style={{ marginTop: 6, color: '#16a34a' }}>
                ✓ Співпадає з збереженим форматом <b>{parsed.matched_format.name}</b> — пресети застосовані. Можеш скорегувати.
              </div>
            )}
            {!parsed.matched_format && (
              <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
                Це новий формат. Wizard зробив guess по назвах колонок — перевір та збережи.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <input style={{ ...input, flex: 1 }} placeholder="Назва формату (e.g. 'Finmap export v1')" value={formatName} onChange={(e) => setFormatName(e.target.value)} />
            <input style={{ ...input, flex: 2 }} placeholder="Опис (опц.)" value={formatDesc} onChange={(e) => setFormatDesc(e.target.value)} />
          </div>

          {/* Mapping table */}
          <h3 style={{ fontSize: 14, marginTop: 24, marginBottom: 8 }}>Мапінг колонок → PMS-полів</h3>
          <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={th}>#</th>
                  <th style={th}>Колонка з файлу</th>
                  <th style={th}>Приклад значення</th>
                  <th style={th}>→ PMS поле</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((h, idx) => {
                  const sample = parsed.sample_rows[0]?.[idx];
                  const sampleStr = sample == null ? '—' : String(sample).substring(0, 60);
                  return (
                    <tr key={idx} style={{ borderTop: '1px solid var(--border-primary)' }}>
                      <td style={{ ...td, color: 'var(--text-secondary)' }}>{idx + 1}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{h || <i style={{ color: 'var(--text-secondary)' }}>(empty)</i>}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>{sampleStr}</td>
                      <td style={td}>
                        <select style={input} value={mapping[idx] || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setMapping((m) => {
                                    const next = { ...m };
                                    if (v === '') delete next[idx];
                                    else next[idx] = v;
                                    return next;
                                  });
                                }}>
                          <option value="">— ігнорувати —</option>
                          {parsed.supported_fields.map((f) => (
                            <option key={f} value={f} disabled={Object.entries(mapping).some(([k, v]) => k !== String(idx) && v === f)}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={backToUpload} style={btn}>Скасувати</button>
            <button onClick={saveAndContinue} disabled={loading} style={{ ...btn, background: '#3b82f6', color: '#fff', border: 'none' }}>
              {loading ? 'Збереження…' : <>💾 Зберегти формат + далі <ArrowRight size={14} /></>}
            </button>
          </div>

          {/* Sample preview (first 5 rows of data using current mapping) */}
          <h3 style={{ fontSize: 14, marginTop: 32, marginBottom: 8 }}>Preview даних (перші 5 рядків з застосованим мапінгом)</h3>
          <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  {Object.entries(mapping).map(([colIdx, field]) => (
                    <th key={colIdx} style={th}>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{parsed.headers[Number(colIdx)]}</div>
                      <div style={{ color: '#3b82f6' }}>→ {field}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.sample_rows.slice(0, 5).map((row, ri) => (
                  <tr key={ri} style={{ borderTop: '1px solid var(--border-primary)' }}>
                    {Object.keys(mapping).map((colIdx) => (
                      <td key={colIdx} style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                        {String(row[Number(colIdx)] ?? '—').substring(0, 50)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* RESOLUTION STAGE (PR #34) */}
      {stage === 'resolution' && resolution && (
        <>
          <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>Stage 2:</b> підтверди маппінг унікальних значень з файлу до існуючих PMS entities.
                Auto-pre-filled: збережені рішення → exact matches → high-similarity ({'>'}85%) → інакше create_new.
              </div>
              <button onClick={() => setStage('mapping')} style={btn}>← Назад до field mapping</button>
            </div>
          </div>

          {(['account', 'category', 'project', 'counterparty'] as EntityType[]).map((et) => {
            const sec = resolution.resolutions[et];
            if (!sec || sec.source_values_count === 0) return null;
            const items = sec.items;

            // Stats
            const exact = items.filter((i) => choices[et][i.source_value]?.action === 'use_existing' && choices[et][i.source_value]?.pms_entity_id === i.exact_match?.id).length;
            const newCount = items.filter((i) => choices[et][i.source_value]?.action === 'create_new').length;
            const ignored = items.filter((i) => choices[et][i.source_value]?.action === 'ignore').length;

            return (
              <div key={et} style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 15, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {ENTITY_LABELS[et]} <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>({items.length} унікальних)</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 12, fontWeight: 400 }}>
                    <span style={{ color: '#22c55e' }}><CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {exact} exact</span>
                    <span style={{ color: '#3b82f6' }}>+ {newCount} new</span>
                    {ignored > 0 && <span style={{ color: 'var(--text-secondary)' }}>{ignored} ignore</span>}
                  </span>
                </h3>
                <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        <th style={th}>Source value</th>
                        <th style={th}>Match</th>
                        <th style={th}>Дія</th>
                        <th style={th}>→ PMS entity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const ch = choices[et][item.source_value] || { pms_entity_id: null, action: 'create_new' as const };
                        const isExact = item.exact_match && ch.pms_entity_id === item.exact_match.id;
                        const topSim = item.candidates[0]?.similarity || 0;
                        const isHighSim = topSim >= 0.85 && ch.pms_entity_id === item.candidates[0]?.id;
                        const matchLabel = isExact ? '✓ EXACT'
                          : isHighSim ? `~${Math.round(topSim * 100)}%`
                          : item.exact_match ? '✓ exact є'
                          : topSim >= 0.5 ? `~${Math.round(topSim * 100)}%`
                          : '—';
                        return (
                          <tr key={item.source_value} style={{ borderTop: '1px solid var(--border-primary)' }}>
                            <td style={{ ...td, fontWeight: 600 }}>{item.source_value}</td>
                            <td style={{ ...td, color: isExact ? '#22c55e' : isHighSim ? '#3b82f6' : 'var(--text-secondary)', fontSize: 11 }}>{matchLabel}</td>
                            <td style={td}>
                              <select style={input} value={ch.action} onChange={(e) => {
                                const newAction = e.target.value as any;
                                setChoices((c) => ({
                                  ...c,
                                  [et]: { ...c[et], [item.source_value]: { ...ch, action: newAction, pms_entity_id: newAction === 'use_existing' ? (ch.pms_entity_id || item.candidates[0]?.id || null) : null } },
                                }));
                              }}>
                                <option value="use_existing">Use existing</option>
                                <option value="create_new">Create new</option>
                                <option value="ignore">Ignore</option>
                              </select>
                            </td>
                            <td style={td}>
                              {ch.action === 'use_existing' ? (
                                <select style={input} value={ch.pms_entity_id || ''} onChange={(e) => {
                                  setChoices((c) => ({
                                    ...c,
                                    [et]: { ...c[et], [item.source_value]: { ...ch, pms_entity_id: e.target.value || null } },
                                  }));
                                }}>
                                  <option value="">— вибери —</option>
                                  {/* Top suggestions (similarity ≥ 50%) shown first */}
                                  {item.candidates.filter((c) => (c.similarity || 0) >= 0.5).length > 0 && (
                                    <optgroup label="Рекомендовані">
                                      {item.candidates.filter((c) => (c.similarity || 0) >= 0.5).map((cand) => (
                                        <option key={cand.id} value={cand.id}>
                                          {cand.name}{cand.meta ? ` (${cand.meta})` : ''} · {Math.round((cand.similarity || 0) * 100)}%
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                  {/* All other entities — manual pick */}
                                  {item.candidates.filter((c) => (c.similarity || 0) < 0.5).length > 0 && (
                                    <optgroup label="Усі інші">
                                      {item.candidates.filter((c) => (c.similarity || 0) < 0.5).map((cand) => (
                                        <option key={cand.id} value={cand.id}>
                                          {cand.name}{cand.meta ? ` (${cand.meta})` : ''}
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                  {item.candidates.length === 0 && <option disabled>— у PMS немає {ENTITY_LABELS[et].toLowerCase()} —</option>}
                                </select>
                              ) : ch.action === 'create_new' ? (
                                <span style={{ color: '#3b82f6', fontStyle: 'italic' }}>Створити «{item.source_value}» при commit</span>
                              ) : (
                                <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Пропустити рядки з цим значенням</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => setStage('mapping')} style={btn}>← Назад</button>
            <button onClick={saveResolutionsAndContinue} disabled={loading} style={{ ...btn, background: '#3b82f6', color: '#fff', border: 'none' }}>
              {loading ? 'Обробка…' : <>💾 Save + Review rows <ArrowRight size={14} /></>}
            </button>
          </div>
        </>
      )}

      {/* REVIEW STAGE (PR #35) */}
      {stage === 'review' && review && parsed && (
        <>
          <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div><b>Stage 3:</b> Перегляд {review.summary.total} рядків. Вибрані будуть створені як fin_operations.</div>
              <button onClick={() => setStage('resolution')} style={btn}>← Назад до resolution</button>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
              <span style={{ color: '#22c55e' }}>● {review.summary.ok} new</span>
              <span style={{ color: '#f59e0b' }}>● {review.summary.possible_dup} possible dup</span>
              <span style={{ color: '#ef4444' }}>● {review.summary.exact_dup} exact dup (skipped)</span>
              {review.summary.errors > 0 && <span style={{ color: '#dc2626' }}>● {review.summary.errors} errors</span>}
              <span style={{ marginLeft: 'auto', fontWeight: 600 }}>Вибрано: {approvedIndices.size}</span>
            </div>
          </div>

          {/* Bulk actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setApprovedIndices(new Set(review.rows.filter((r) => r.status === 'ok').map((r) => r.index)))} style={btn}>
              Тільки 🟢 new ({review.summary.ok})
            </button>
            <button onClick={() => setApprovedIndices(new Set(review.rows.filter((r) => r.status === 'ok' || r.status === 'possible_dup').map((r) => r.index)))} style={btn}>
              🟢 new + 🟡 possible dup ({review.summary.ok + review.summary.possible_dup})
            </button>
            <button onClick={() => setApprovedIndices(new Set(review.rows.filter((r) => r.status !== 'error').map((r) => r.index)))} style={btn}>
              Все крім errors ({review.summary.total - review.summary.errors})
            </button>
            <button onClick={() => setApprovedIndices(new Set())} style={btn}>Зняти всі</button>
            <button onClick={commitFinal} disabled={committing || approvedIndices.size === 0} style={{ marginLeft: 'auto', ...btn, background: '#16a34a', color: '#fff', border: 'none', fontWeight: 700 }}>
              {committing ? 'Створення…' : `✓ COMMIT ${approvedIndices.size} рядків`}
            </button>
          </div>

          {/* Commit result */}
          {commitResult && (
            <div style={{ padding: 16, marginBottom: 16, background: 'rgba(34,197,94,0.08)', border: '1px solid #16a34a', borderRadius: 10 }}>
              <div style={{ fontWeight: 600, color: '#16a34a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} /> Імпорт виконано
              </div>
              <div style={{ fontSize: 13 }}>
                Створено fin_operations: <b>{commitResult.created}</b>{' '}
                · auto-created accounts: <b>{commitResult.entities_created.accounts}</b>{' '}
                · categories: <b>{commitResult.entities_created.categories}</b>{' '}
                · projects: <b>{commitResult.entities_created.projects}</b>{' '}
                · counterparties: <b>{commitResult.entities_created.counterparties}</b>
                {commitResult.errors.length > 0 && <span style={{ color: '#ef4444' }}> · errors: {commitResult.errors.length}</span>}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                Run ID: <code>{commitResult.run_id}</code> · фільтр у /finance/operations: <code>source = wizard_import</code>
              </div>
            </div>
          )}

          {/* Row table */}
          <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'auto', maxHeight: '60vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
                <tr>
                  <th style={th}><input type="checkbox" checked={approvedIndices.size === review.rows.length && review.rows.length > 0} onChange={(e) => {
                    if (e.target.checked) setApprovedIndices(new Set(review.rows.map((r) => r.index)));
                    else setApprovedIndices(new Set());
                  }} /></th>
                  <th style={th}>#</th>
                  <th style={th}>Status</th>
                  <th style={th}>Дата</th>
                  <th style={{ ...th, textAlign: 'right' }}>Сума</th>
                  <th style={th}>Тип</th>
                  <th style={th}>From → To</th>
                  <th style={th}>Категорія</th>
                  <th style={th}>Проєкт</th>
                  <th style={th}>Коментар</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((r) => {
                  const statusColor = r.status === 'ok' ? '#22c55e' : r.status === 'possible_dup' ? '#f59e0b' : r.status === 'exact_dup' ? '#ef4444' : '#dc2626';
                  const statusLabel = r.status === 'ok' ? '🟢 new' : r.status === 'possible_dup' ? '🟡 dup?' : r.status === 'exact_dup' ? '🔴 exact' : '❌ error';
                  return (
                    <tr key={r.index} style={{ borderTop: '1px solid var(--border-primary)', background: r.status === 'error' ? 'rgba(220,38,38,0.05)' : undefined }}>
                      <td style={td}>
                        <input type="checkbox" disabled={r.status === 'error'}
                               checked={approvedIndices.has(r.index)}
                               onChange={(e) => {
                                 const next = new Set(approvedIndices);
                                 if (e.target.checked) next.add(r.index); else next.delete(r.index);
                                 setApprovedIndices(next);
                               }} />
                      </td>
                      <td style={{ ...td, color: 'var(--text-secondary)' }}>{r.index + 1}</td>
                      <td style={{ ...td, color: statusColor, fontWeight: 600 }}>{statusLabel}</td>
                      <td style={td}>{r.paid_at || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {r.amount.toLocaleString('cs-CZ', { minimumFractionDigits: 2 })} {r.currency}
                      </td>
                      <td style={td}>{r.op_type || '?'}</td>
                      <td style={td}>
                        {r.account_from?.source && <span>{r.account_from.source}{r.account_from.action === 'create_new' && ' (new)'}</span>}
                        {r.account_from?.source && r.account_to?.source && ' → '}
                        {r.account_to?.source && <span>{r.account_to.source}{r.account_to.action === 'create_new' && ' (new)'}</span>}
                      </td>
                      <td style={td}>
                        <RowEntitySelect
                          entry={r.category}
                          options={review.all_entities.category}
                          onChange={(next) => updateRowField(r.index, 'category', next)}
                        />
                      </td>
                      <td style={td}>
                        <RowEntitySelect
                          entry={r.project}
                          options={review.all_entities.project}
                          onChange={(next) => updateRowField(r.index, 'project', next)}
                        />
                      </td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {r.comment || (r.error && <span style={{ color: '#dc2626' }}>{r.error}</span>) || '—'}
                        {r.duplicate_candidates.length > 0 && (
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ fontSize: 10, color: '#f59e0b', cursor: 'pointer' }}>
                              Існуючі: {r.duplicate_candidates.length}
                            </summary>
                            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                              {r.duplicate_candidates.map((c, i) => (
                                <div key={i}>· {c.paid_at} {c.amount.toFixed(2)} ({c.source}) {c.comment ? `— ${c.comment.substring(0, 40)}` : ''}</div>
                              ))}
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function RowEntitySelect({
  entry, options, onChange,
}: {
  entry: { source: string; resolved_id: string | null; action: string } | null;
  options: { id: string; name: string; meta?: string }[];
  onChange: (next: { source: string; resolved_id: string | null; action: 'use_existing' | 'create_new' | 'ignore' }) => void;
}) {
  const source = entry?.source || '';
  const action = (entry?.action || 'ignore') as 'use_existing' | 'create_new' | 'ignore';
  let value = '__ignore__';
  if (action === 'use_existing' && entry?.resolved_id) value = entry.resolved_id;
  else if (action === 'create_new') value = '__create__';

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__ignore__') onChange({ source, resolved_id: null, action: 'ignore' });
        else if (v === '__create__') onChange({ source, resolved_id: null, action: 'create_new' });
        else onChange({ source: source || options.find((o) => o.id === v)?.name || '', resolved_id: v, action: 'use_existing' });
      }}
      style={{ padding: '4px 6px', fontSize: 11, border: '1px solid var(--border-primary)', borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-primary)', maxWidth: 240 }}
      title={source ? `Source: «${source}»` : 'No source value in row'}
    >
      <option value="__ignore__">— ігнорувати —</option>
      {source && <option value="__create__">+ створити «{source}»</option>}
      {options.length > 0 && (
        <optgroup label="Існуючі в PMS">
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}{o.meta ? ` · ${o.meta}` : ''}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function Stage({ n, label, active, done, disabled }: { n: number; label: string; active: boolean; done: boolean; disabled?: boolean }) {
  const color = done ? '#22c55e' : active ? '#3b82f6' : disabled ? 'var(--text-secondary)' : 'var(--text-secondary)';
  return (
    <div style={{ flex: 1, padding: 12, borderRadius: 8, background: active ? 'rgba(59,130,246,0.08)' : done ? 'rgba(34,197,94,0.08)' : 'var(--bg-secondary)', borderLeft: `3px solid ${color}`, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontSize: 11, color, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Stage {n}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

const backLink: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none' };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 13, fontWeight: 500, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer' };
const input: React.CSSProperties = { padding: '7px 10px', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, background: 'var(--bg-primary)', color: 'var(--text-primary)' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)' };
const td: React.CSSProperties = { padding: '6px 12px' };
