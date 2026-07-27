/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Import wizard Stage 3 — row processing + duplicate detection + commit.
//
// Takes the parsed rows + saved field_mappings + saved entity resolutions
// and produces a per-row decision list:
//   - 'ok': row is clean, will create a new fin_operation
//   - 'possible_dup': existing fin_operation matches by date ±2d + amount
//      ±0.01 + same direction. User decides per-row.
//   - 'exact_dup': existing op exact match (same date, amount, account)
//      → suggested skip
//   - 'error': missing required fields, no resolved account, etc.
//
// On commit, only rows with user-approved decisions are written. Auto-
// create entities only happen here (Stage 2 just declared "create_new"
// intent — no DB writes until commit).
//

import * as crypto from 'crypto';
import { createOperationInTx } from '../api/operations.handlers';
import { loadAllPmsEntities, type PmsEntity } from './entity-matcher';

export type RowStatus = 'ok' | 'possible_dup' | 'exact_dup' | 'error';

export interface ProcessedRow {
  index: number;                     // original row index
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

export interface ProcessSummary {
  total: number;
  ok: number;
  possible_dup: number;
  exact_dup: number;
  errors: number;
}

interface FieldMappings { [colIdx: number]: string }

interface EntityRes { [sourceValue: string]: { pms_entity_id: string | null; action: 'use_existing' | 'create_new' | 'ignore' } }

function loadResolutions(db: any, formatId: string): { account: EntityRes; category: EntityRes; project: EntityRes; counterparty: EntityRes } {
  const out: any = { account: {}, category: {}, project: {}, counterparty: {} };
  const rows = db.prepare(
    "SELECT entity_type, source_value, pms_entity_id, action FROM import_entity_mappings WHERE format_id = ?"
  ).all(formatId) as any[];
  for (const r of rows) {
    if (!out[r.entity_type]) out[r.entity_type] = {};
    out[r.entity_type][r.source_value] = { pms_entity_id: r.pms_entity_id, action: r.action };
  }
  return out;
}

function colByField(fm: FieldMappings, field: string): number | null {
  for (const [k, v] of Object.entries(fm)) {
    if (v === field) return parseInt(k, 10);
  }
  return null;
}

function colsByField(fm: FieldMappings, field: string): number[] {
  const out: number[] = [];
  for (const [k, v] of Object.entries(fm)) if (v === field) out.push(parseInt(k, 10));
  return out;
}

function pickStr(row: any[], col: number | null): string {
  if (col == null) return '';
  const v = row[col];
  return v == null ? '' : String(v).trim();
}

function pickFirstNonEmpty(row: any[], cols: number[]): string {
  for (const c of cols) {
    const v = pickStr(row, c);
    if (v) return v;
  }
  return '';
}

function parseDate(s: string): string | null {
  if (!s) return null;
  // ISO-prefix
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  return null;
}

function parseNum(s: string): number {
  const cleaned = s.replace(/\s/g, '').replace(/,(?=\d{3})/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function resolveEntity(
  resolutions: EntityRes,
  sourceValue: string,
): { source: string; resolved_id: string | null; action: string } | null {
  if (!sourceValue) return null;
  const r = resolutions[sourceValue];
  if (!r) {
    return { source: sourceValue, resolved_id: null, action: 'create_new' };
  }
  return { source: sourceValue, resolved_id: r.pms_entity_id, action: r.action };
}

function inferCurrencyFromAccountName(name: string): string | null {
  const l = name.toLowerCase();
  if (l.includes('eur') || l.includes('євро') || l.includes('евро')) return 'EUR';
  if (l.includes('czk') || l.includes('крон') || l.includes('кч')) return 'CZK';
  if (l.includes('usd') || l.includes('долар')) return 'USD';
  return null;
}

export function processRowsForReview(
  db: any, orgId: string, formatId: string,
  fieldMappings: FieldMappings, allRows: any[][],
): { rows: ProcessedRow[]; summary: ProcessSummary; all_entities: { category: PmsEntity[]; project: PmsEntity[] } } {
  const resolutions = loadResolutions(db, formatId);

  const colPaidAt   = colByField(fieldMappings, 'paid_at');
  const colAccrued  = colByField(fieldMappings, 'accrued_at');
  const colAmount   = colByField(fieldMappings, 'amount');
  const colCurrency = colByField(fieldMappings, 'currency');
  const colAccFrom  = colByField(fieldMappings, 'account_from');
  const colAccTo    = colByField(fieldMappings, 'account_to');
  const colCategory = colByField(fieldMappings, 'category');
  const colProject  = colByField(fieldMappings, 'project');
  const colCp       = colByField(fieldMappings, 'counterparty');
  const colComment  = colByField(fieldMappings, 'comment');
  const colsTags    = colsByField(fieldMappings, 'tags');
  const colOpType   = colByField(fieldMappings, 'op_type');

  const summary: ProcessSummary = { total: allRows.length, ok: 0, possible_dup: 0, exact_dup: 0, errors: 0 };
  const out: ProcessedRow[] = [];

  // Pre-load account currencies — used to infer transaction currency when
  // the source CSV has no explicit currency column or empty cell. Fixes the
  // bug where EUR transactions on KB Euro got tagged CZK by default.
  const accountCurrencies = new Map<string, string>();
  const accRows = db.prepare(
    "SELECT id, currency FROM finance_accounts WHERE organization_id = ?"
  ).all(orgId) as { id: string; currency: string }[];
  for (const a of accRows) accountCurrencies.set(a.id, a.currency);

  // Pre-load fin_operations for dup detection (last 18 months window)
  const eighteenMonthsAgo = new Date(Date.now() - 540 * 24 * 3600 * 1000).toISOString().substring(0, 10);
  const existingOps = db.prepare(`
    SELECT id, paid_at, amount, currency, account_from_id, account_to_id, op_type, comment, source
    FROM fin_operations WHERE organization_id = ? AND paid_at >= ?
  `).all(orgId, eighteenMonthsAgo) as any[];

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];

    const rawDate = pickStr(row, colPaidAt);
    const paidAt = parseDate(rawDate);
    const rawAccrued = pickStr(row, colAccrued);
    const accruedAt = parseDate(rawAccrued) || paidAt;
    const amount = parseNum(pickStr(row, colAmount));

    const accountFrom = resolveEntity(resolutions.account, pickStr(row, colAccFrom));
    const accountTo   = resolveEntity(resolutions.account, pickStr(row, colAccTo));
    const category    = resolveEntity(resolutions.category, pickStr(row, colCategory));
    const project     = resolveEntity(resolutions.project, pickStr(row, colProject));
    const counterparty= resolveEntity(resolutions.counterparty, pickStr(row, colCp));

    let currency = pickStr(row, colCurrency).toUpperCase();
    if (!currency) {
      const accId = accountTo?.resolved_id || accountFrom?.resolved_id;
      if (accId) currency = accountCurrencies.get(accId) || '';
      if (!currency) {
        const newAccName = accountTo?.action === 'create_new' ? accountTo.source
                         : accountFrom?.action === 'create_new' ? accountFrom.source : '';
        if (newAccName) currency = inferCurrencyFromAccountName(newAccName) || '';
      }
      if (!currency) currency = 'CZK';
    }

    const explicitType = pickStr(row, colOpType).toLowerCase();
    let opType: 'income' | 'expense' | 'transfer' | null = null;
    if (explicitType === 'income' || explicitType === 'expense' || explicitType === 'transfer') {
      opType = explicitType;
    } else if (accountTo && !accountFrom) opType = 'income';
    else if (accountFrom && !accountTo) opType = 'expense';
    else if (accountFrom && accountTo) opType = 'transfer';

    const tagParts: string[] = [];
    for (const c of colsTags) { const v = pickStr(row, c); if (v) tagParts.push(`#${v}`); }
    const commentRaw = pickStr(row, colComment);
    const comment = [commentRaw, ...tagParts].filter(Boolean).join(' ').trim() || null;

    let error: string | null = null;
    let status: RowStatus = 'ok';
    if (!paidAt) { status = 'error'; error = 'No valid paid_at date'; }
    else if (!amount) { status = 'error'; error = 'Missing or zero amount'; }
    else if (!opType) { status = 'error'; error = 'Cannot determine op_type (no account_from or account_to mapped)'; }
    // Ignored entities don't error — but if a required account is ignored, it's an error
    else if (opType === 'income' && accountTo?.action === 'ignore') { status = 'error'; error = 'account_to is set to ignore'; }
    else if (opType === 'expense' && accountFrom?.action === 'ignore') { status = 'error'; error = 'account_from is set to ignore'; }

    // Duplicate detection (only for non-error rows)
    const dupCandidates: ProcessedRow['duplicate_candidates'] = [];
    if (status !== 'error' && paidAt) {
      const targetDate = new Date(paidAt).getTime();
      for (const op of existingOps) {
        if (op.currency !== currency) continue;
        if (Math.abs(op.amount - amount) > 0.01) continue;
        const opDate = new Date(op.paid_at).getTime();
        const daysDiff = Math.abs(opDate - targetDate) / (24 * 3600 * 1000);
        if (daysDiff > 2) continue;
        if (opType && op.op_type !== opType) continue;
        dupCandidates.push({
          id: op.id, paid_at: op.paid_at?.substring(0, 10), amount: op.amount,
          comment: op.comment, source: op.source,
        });
      }
      // Exact dup: same date, same amount, same account (currency already match)
      const exactDup = dupCandidates.find((c) => c.paid_at === paidAt);
      if (exactDup) status = 'exact_dup';
      else if (dupCandidates.length > 0) status = 'possible_dup';
    }

    if (status === 'error') summary.errors++; else summary[status]++;
    out.push({
      index: i,
      status, error,
      paid_at: paidAt, amount, currency, op_type: opType,
      account_from: accountFrom, account_to: accountTo,
      category, project, counterparty,
      comment,
      duplicate_candidates: dupCandidates.slice(0, 3),
    });
  }

  // Bundle full PMS category + project lists so the review UI can let the
  // user override the auto-resolved choice per row inline.
  const all_entities = {
    category: loadAllPmsEntities(db, orgId, 'category'),
    project:  loadAllPmsEntities(db, orgId, 'project'),
  };

  return { rows: out, summary, all_entities };
}

// ─── Auto-create entity helpers ─────────────────────────

function inferAccountTypeFromName(name: string): 'cash' | 'bank' | 'investment' | 'other' {
  const l = name.toLowerCase();
  if (l.includes('налич') || l.includes('готів') || l.includes('cash')) return 'cash';
  if (l.includes('инвест') || l.includes('інвест') || l.includes('invest')) return 'investment';
  if (l.includes('kb') || l.includes('bank') || l.includes('банк')) return 'bank';
  return 'other';
}

function autoCreateEntity(
  db: any, orgId: string,
  type: 'account' | 'category' | 'project' | 'counterparty',
  name: string, hint?: { currency?: string; op_type?: string },
): string {
  if (type === 'account') {
    const currency = hint?.currency || (name.toLowerCase().includes('eur') ? 'EUR' : 'CZK');
    const accType = inferAccountTypeFromName(name);
    const id = `acct_imp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO finance_accounts (id, organization_id, name, type, currency, color, sort_order)
      VALUES (?, ?, ?, ?, ?, '#94a3b8', 500)
    `).run(id, orgId, name, accType, currency);
    return id;
  }
  if (type === 'category') {
    const opType = hint?.op_type === 'income' ? 'income' : 'expense';
    const id = `ec_imp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO expense_categories
        (id, organization_id, name, op_type, classifier, std_group, pnl_line, include_in_pnl, include_in_cash, alloc_method, is_capex, icon, color, sort_order, is_active)
      VALUES (?, ?, ?, ?, 'operational', 'OPEX', ?, 1, 1, 'NONE', 0, '📦', '#94a3b8', 500, 1)
    `).run(id, orgId, name, opType, name);
    return id;
  }
  if (type === 'project') {
    const id = `bu_imp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO business_units (id, organization_id, name, sort_order, is_active, is_shared)
      VALUES (?, ?, ?, 500, 1, 0)
    `).run(id, orgId, name);
    return id;
  }
  // counterparty
  const id = `cp_imp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  db.prepare(`
    INSERT INTO finance_counterparties (id, organization_id, name, kind, sort_order, is_active)
    VALUES (?, ?, ?, 'other', 500, 1)
  `).run(id, orgId, name);
  return id;
}

export interface CommitInput {
  formatId: string;
  fileName: string;
  approvedRows: ProcessedRow[];
}

export interface CommitResult {
  ok: boolean;
  run_id: string;
  created: number;
  errors: { index: number; message: string }[];
  entities_created: { accounts: number; categories: number; projects: number; counterparties: number };
}

export function commitApprovedRows(db: any, orgId: string, input: CommitInput): CommitResult {
  const result: CommitResult = {
    ok: true, run_id: '', created: 0, errors: [],
    entities_created: { accounts: 0, categories: 0, projects: 0, counterparties: 0 },
  };

  // Cache for entities created during this commit (by source value, so we
  // don't create duplicates for the same source value within one batch)
  const cache: Record<'account' | 'category' | 'project' | 'counterparty', Map<string, string>> = {
    account: new Map(), category: new Map(), project: new Map(), counterparty: new Map(),
  };

  function resolveOrCreate(
    type: 'account' | 'category' | 'project' | 'counterparty',
    entry: ProcessedRow['account_from'],
    hint?: { currency?: string; op_type?: string },
  ): string | null {
    if (!entry) return null;
    if (entry.action === 'ignore') return null;
    if (entry.action === 'use_existing' && entry.resolved_id) return entry.resolved_id;
    if (entry.action === 'create_new') {
      const cached = cache[type].get(entry.source);
      if (cached) return cached;
      const id = autoCreateEntity(db, orgId, type, entry.source, hint);
      cache[type].set(entry.source, id);
      result.entities_created[type === 'account' ? 'accounts' : type === 'category' ? 'categories' : type === 'project' ? 'projects' : 'counterparties']++;
      return id;
    }
    return null;
  }

  const tx = db.transaction(() => {
    for (const r of input.approvedRows) {
      try {
        if (r.status === 'error' || !r.paid_at || !r.op_type) {
          result.errors.push({ index: r.index, message: r.error || 'Unprocessable row' });
          continue;
        }
        const accFrom = resolveOrCreate('account', r.account_from, { currency: r.currency });
        const accTo   = resolveOrCreate('account', r.account_to,   { currency: r.currency });
        const cat     = resolveOrCreate('category', r.category, { op_type: r.op_type });
        const proj    = resolveOrCreate('project',  r.project);
        const cp      = resolveOrCreate('counterparty', r.counterparty);

        const sourceRef = `imp:${input.formatId}:${r.index}`;
        createOperationInTx(db, orgId, {
          op_type: r.op_type,
          account_from_id: accFrom,
          account_to_id: accTo,
          amount: Math.abs(r.amount),
          currency: r.currency,
          paid_at: r.paid_at,
          category_id: cat,
          project_id: proj,
          counterparty_id: cp,
          comment: r.comment,
          source: 'wizard_import',
          source_ref: sourceRef,
          status: 'completed',
        });
        result.created++;
      } catch (e: any) {
        result.errors.push({ index: r.index, message: e.message });
      }
    }

    // Persist run audit log
    const runId = `imrun_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO import_runs
        (id, organization_id, format_id, file_name, rows_total, rows_created, rows_skipped, rows_dup, errors_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed')
    `).run(
      runId, orgId, input.formatId, input.fileName,
      input.approvedRows.length, result.created,
      input.approvedRows.length - result.created - result.errors.length,
      0, result.errors.length,
    );
    result.run_id = runId;
  });
  tx();

  return result;
}
