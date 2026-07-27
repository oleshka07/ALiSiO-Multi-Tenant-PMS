/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Fuzzy matcher for import wizard entity resolution.
//
// For each unique source value (e.g. "Аренда" from Finmap), looks up
// existing PMS entities of the matching type and returns the top
// candidates ranked by similarity. UI then shows those as suggestions
// for the dropdown.
//

export type EntityType = 'account' | 'category' | 'project' | 'counterparty';

export interface PmsEntity {
  id: string;
  name: string;
  meta?: string;     // small extra (currency, parent, kind)
  similarity?: number;
}

export interface EntityCandidate {
  source_value: string;
  candidates: PmsEntity[];
  exact_match: PmsEntity | null;
  saved_resolution: { entity_id: string | null; action: 'use_existing' | 'create_new' | 'ignore' } | null;
}

const ENTITY_TABLES: Record<EntityType, { table: string; selectExtra?: string }> = {
  account:      { table: 'finance_accounts',       selectExtra: 'currency, type' },
  category:     { table: 'expense_categories',     selectExtra: 'op_type' },
  project:      { table: 'business_units',         selectExtra: '' },
  counterparty: { table: 'finance_counterparties', selectExtra: 'kind' },
};

function normalise(s: string): string {
  return s.toLowerCase()
    .replace(/[іії]/g, 'и').replace(/[єё]/g, 'е').replace(/ґ/g, 'г')
    .replace(/[^a-zа-я0-9]/g, '');
}

/**
 * Levenshtein distance (small implementation, O(m·n)). Capped at 100 chars
 * each side to bound runtime — entity names are short.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const A = a.substring(0, 100);
  const B = b.substring(0, 100);
  const m = A.length, n = B.length;
  const v0 = new Array(n + 1);
  const v1 = new Array(n + 1);
  for (let i = 0; i <= n; i++) v0[i] = i;
  for (let i = 0; i < m; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < n; j++) {
      const cost = A[i] === B[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= n; j++) v0[j] = v1[j];
  }
  return v0[n];
}

function similarity(a: string, b: string): number {
  const na = normalise(a);
  const nb = normalise(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
}

export function loadAllPmsEntities(db: any, orgId: string, type: EntityType): PmsEntity[] {
  const cfg = ENTITY_TABLES[type];
  const extraCols = cfg.selectExtra ? `, ${cfg.selectExtra}` : '';
  const rows = db.prepare(
    `SELECT id, name${extraCols} FROM ${cfg.table} WHERE organization_id = ? ORDER BY name`
  ).all(orgId) as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    meta: cfg.selectExtra ? cfg.selectExtra.split(',').map((c) => r[c.trim()]).filter(Boolean).join(' · ') : undefined,
  }));
}

/**
 * For a given list of source values + entity type, returns per-value
 * candidate suggestions ranked by similarity. Also bundles any
 * previously-saved resolution from import_entity_mappings.
 */
export function buildEntityCandidates(
  db: any, orgId: string, formatId: string | null,
  type: EntityType, sourceValues: string[],
): EntityCandidate[] {
  const allPms = loadAllPmsEntities(db, orgId, type);

  // Pre-load saved resolutions for this format
  const savedMap = new Map<string, { entity_id: string | null; action: any }>();
  if (formatId) {
    const rows = db.prepare(
      "SELECT source_value, pms_entity_id, action FROM import_entity_mappings WHERE format_id = ? AND entity_type = ?"
    ).all(formatId, type) as any[];
    for (const r of rows) {
      savedMap.set(r.source_value, { entity_id: r.pms_entity_id, action: r.action });
    }
  }

  const out: EntityCandidate[] = [];
  for (const src of sourceValues) {
    if (!src.trim()) continue;
    let exact: PmsEntity | null = null;
    // Score ALL PMS entities — UI needs to fall back to full list when
    // no high-similarity matches exist (so user can manually pick anything).
    // Sorted by similarity, best first.
    const scored: PmsEntity[] = allPms.map((e) => {
      const sim = similarity(src, e.name);
      if (sim === 1) exact = { ...e, similarity: 1 };
      return { ...e, similarity: sim };
    });
    scored.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    out.push({
      source_value: src,
      candidates: scored, // ALL entities returned, UI shows full list in dropdown
      exact_match: exact,
      saved_resolution: savedMap.get(src) || null,
    });
  }
  return out.sort((a, b) => a.source_value.localeCompare(b.source_value));
}

/**
 * Persist a list of resolutions to import_entity_mappings.
 * Upserts via UNIQUE(format_id, entity_type, source_value).
 */
export function saveResolutions(
  db: any, formatId: string,
  type: EntityType,
  resolutions: { source_value: string; pms_entity_id: string | null; action: 'use_existing' | 'create_new' | 'ignore' }[],
): number {
  const stmt = db.prepare(`
    INSERT INTO import_entity_mappings (format_id, entity_type, source_value, pms_entity_id, action)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(format_id, entity_type, source_value) DO UPDATE SET
      pms_entity_id = excluded.pms_entity_id,
      action = excluded.action,
      updated_at = datetime('now')
  `);
  const tx = db.transaction(() => {
    for (const r of resolutions) {
      if (!r.source_value.trim()) continue;
      stmt.run(formatId, type, r.source_value, r.pms_entity_id, r.action);
    }
  });
  tx();
  return resolutions.length;
}
