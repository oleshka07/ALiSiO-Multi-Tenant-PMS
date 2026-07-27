/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Supabase → ALiSiO PMS investor data importer.
//
// User exports each table as CSV from Supabase Dashboard:
//   - properties.csv    → business_units (+ property_work_stages JSON)
//   - investors.csv     → investors
//   - investments.csv   → investor_investments
//   - payments.csv      → investor_payouts
//   - metrics.csv       → property_monthly_metrics
//   - (optional) monthly_reports.csv (TODO future)
//
// Idempotent via supabase_id column added in PR #36 (+ business_units
// gets a similar mechanism via name match — already present).
//
// Investments / payments / metrics use property_id (Supabase PK) as the
// foreign key — engine builds an in-memory map from properties_csv +
// pre-existing business_units (matched by name fallback).
//

import * as crypto from 'crypto';

interface CsvRow { [col: string]: string }

function parseCsv(text: string): CsvRow[] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
  const allRows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(cell); allRows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); allRows.push(row); }
  const filtered = allRows.filter((r) => r.some((c) => c.trim().length > 0));
  if (filtered.length < 2) return [];
  const headers = filtered[0].map((h) => h.trim());
  return filtered.slice(1).map((r) => {
    const obj: CsvRow = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    return obj;
  });
}

function normName(s: string): string {
  return s.toLowerCase()
    .replace(/[іії]/g, 'и').replace(/[єё]/g, 'е').replace(/ґ/g, 'г')
    .replace(/[^a-zа-я0-9]/g, '');
}

function pickFirst(row: CsvRow, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  return '';
}

function num(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function toIsoDate(s: string): string {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  return s.substring(0, 10);
}

export interface SupabaseImportResult {
  properties:   { parsed: number; created: number; skipped: number; errors: string[] };
  investors:    { parsed: number; created: number; skipped: number; errors: string[] };
  investments:  { parsed: number; created: number; skipped: number; errors: string[]; unmatched_properties: string[] };
  payments:     { parsed: number; created: number; skipped: number; errors: string[]; unmatched_properties: string[] };
  metrics:      { parsed: number; created: number; skipped: number; errors: string[]; unmatched_properties: string[] };
}

export interface SupabaseImportInput {
  propertiesCsv?: string;
  investorsCsv?: string;
  investmentsCsv?: string;
  paymentsCsv?: string;
  metricsCsv?: string;
  dryRun?: boolean;
}

export function runSupabaseImport(db: any, orgId: string, input: SupabaseImportInput): SupabaseImportResult {
  const result: SupabaseImportResult = {
    properties:   { parsed: 0, created: 0, skipped: 0, errors: [] },
    investors:    { parsed: 0, created: 0, skipped: 0, errors: [] },
    investments:  { parsed: 0, created: 0, skipped: 0, errors: [], unmatched_properties: [] },
    payments:     { parsed: 0, created: 0, skipped: 0, errors: [], unmatched_properties: [] },
    metrics:      { parsed: 0, created: 0, skipped: 0, errors: [], unmatched_properties: [] },
  };

  // ─── Build property mapping (supabase_id → local business_unit id) ───
  // 1. Pre-load existing business_units by name (normalised)
  const existingBus = db.prepare(
    "SELECT id, name FROM business_units WHERE organization_id = ?"
  ).all(orgId) as { id: string; name: string }[];
  const localBusByNormName = new Map<string, string>();
  for (const r of existingBus) localBusByNormName.set(normName(r.name), r.id);

  // 2. property_id (supabase) → local business_unit id
  const propertyMap = new Map<string, string>();
  // 3. property name (Supabase) for messages — supabase_id → name
  const propertyName = new Map<string, string>();

  const investorBySupabaseId = new Map<string, string>();
  const existingInvestors = db.prepare(
    "SELECT id, supabase_id FROM investors WHERE organization_id = ? AND supabase_id IS NOT NULL"
  ).all(orgId) as { id: string; supabase_id: string }[];
  for (const r of existingInvestors) investorBySupabaseId.set(r.supabase_id, r.id);

  const tx = db.transaction(() => {

    // ─── PROPERTIES ─────────────────────────────────────
    if (input.propertiesCsv) {
      const rows = parseCsv(input.propertiesCsv);
      result.properties.parsed = rows.length;
      const insertBu = db.prepare(`
        INSERT INTO business_units (id, organization_id, name, sort_order, is_active, is_shared)
        VALUES (?, ?, ?, 500, 1, 0)
      `);
      const upsertStages = db.prepare(`
        INSERT INTO property_work_stages (id, project_id, stages_json)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          stages_json = excluded.stages_json,
          updated_at = datetime('now')
      `);
      const upsertDetails = db.prepare(`
        INSERT INTO investor_property_details (id, project_id, location, image_url, airbnb_url, ical_url, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          location   = excluded.location,
          image_url  = excluded.image_url,
          airbnb_url = excluded.airbnb_url,
          ical_url   = excluded.ical_url,
          status     = excluded.status,
          updated_at = datetime('now')
      `);

      function detailsForRow(r: CsvRow): { location: string | null; image_url: string | null; airbnb_url: string | null; ical_url: string | null; status: string } {
        const rawStatus = (pickFirst(r, 'status') || '').toLowerCase();
        let status = 'active';
        if (rawStatus.includes('progress')) status = 'in_progress';
        else if (rawStatus === 'project') status = 'project';
        else if (rawStatus === 'paused') status = 'paused';
        return {
          location:   pickFirst(r, 'location') || null,
          image_url:  pickFirst(r, 'image_url') || null,
          airbnb_url: pickFirst(r, 'airbnb_url') || null,
          ical_url:   pickFirst(r, 'ical_url') || null,
          status,
        };
      }

      for (const r of rows) {
        try {
          const supabaseId = pickFirst(r, 'id', 'property_id');
          const name = pickFirst(r, 'name');
          if (!supabaseId || !name) {
            result.properties.errors.push(`Missing id/name in row`);
            continue;
          }
          propertyName.set(supabaseId, name);

          // Match by normalised name to existing business_unit
          const localId = localBusByNormName.get(normName(name));
          if (localId) {
            propertyMap.set(supabaseId, localId);
            result.properties.skipped++;
            if (!input.dryRun) {
              const stagesJson = pickFirst(r, 'work_stages');
              if (stagesJson) {
                const stagesId = `pws_sb_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
                upsertStages.run(stagesId, localId, stagesJson);
              }
              const d = detailsForRow(r);
              upsertDetails.run(`pd_sb_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
                localId, d.location, d.image_url, d.airbnb_url, d.ical_url, d.status);
            }
            continue;
          }

          if (input.dryRun) { result.properties.created++; continue; }

          // Create new business_unit
          const newId = `bu_sb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          insertBu.run(newId, orgId, name);
          propertyMap.set(supabaseId, newId);
          localBusByNormName.set(normName(name), newId);
          result.properties.created++;

          // Add work_stages + details
          const stagesJson = pickFirst(r, 'work_stages');
          if (stagesJson) {
            const stagesId = `pws_sb_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
            upsertStages.run(stagesId, newId, stagesJson);
          }
          const d = detailsForRow(r);
          upsertDetails.run(`pd_sb_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            newId, d.location, d.image_url, d.airbnb_url, d.ical_url, d.status);
        } catch (e: any) {
          result.properties.errors.push(e.message);
        }
      }
    } else {
      // No properties CSV — try to populate propertyMap from existing
      // business_units' supabase_id-prefixed entries (none exist yet),
      // so investments/payments/metrics that reference property_id will
      // fail unless properties_csv is provided.
    }

    // ─── INVESTORS ──────────────────────────────────────
    if (input.investorsCsv) {
      const rows = parseCsv(input.investorsCsv);
      result.investors.parsed = rows.length;
      const checkExisting = db.prepare(
        "SELECT id FROM investors WHERE organization_id = ? AND supabase_id = ?"
      );
      const insert = db.prepare(`
        INSERT INTO investors
          (id, organization_id, name, email, phone, telegram_chat_id, portal_token, status, notes, supabase_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of rows) {
        try {
          const supabaseId = pickFirst(r, 'id', 'investor_id', 'uuid');
          const name = pickFirst(r, 'name', 'full_name');
          if (!supabaseId || !name) {
            result.investors.errors.push(`Missing id/name`);
            continue;
          }
          const existing = checkExisting.get(orgId, supabaseId) as { id: string } | undefined;
          if (existing) {
            investorBySupabaseId.set(supabaseId, existing.id);
            result.investors.skipped++;
            continue;
          }
          if (input.dryRun) { result.investors.created++; continue; }
          const localId = `inv_sb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          const token = pickFirst(r, 'token', 'portal_token') || crypto.randomBytes(32).toString('hex');
          insert.run(
            localId, orgId, name,
            pickFirst(r, 'email') || null,
            pickFirst(r, 'phone') || null,
            pickFirst(r, 'telegram_chat_id', 'telegramChatId', 'tg_chat_id') || null,
            token,
            (pickFirst(r, 'status') || 'active') === 'archived' ? 'archived' : 'active',
            pickFirst(r, 'notes') || null,
            supabaseId,
          );
          investorBySupabaseId.set(supabaseId, localId);
          result.investors.created++;
        } catch (e: any) {
          result.investors.errors.push(e.message);
        }
      }
    }

    // Helper to resolve property_id reference
    function resolvePropId(supabasePropId: string, unmatched: Set<string>): string | null {
      if (!supabasePropId) return null;
      const local = propertyMap.get(supabasePropId);
      if (local) return local;
      unmatched.add(propertyName.get(supabasePropId) || supabasePropId);
      return null;
    }

    // ─── INVESTMENTS ────────────────────────────────────
    if (input.investmentsCsv) {
      const rows = parseCsv(input.investmentsCsv);
      result.investments.parsed = rows.length;
      const checkExisting = db.prepare(
        "SELECT id FROM investor_investments WHERE organization_id = ? AND supabase_id = ?"
      );
      const insert = db.prepare(`
        INSERT INTO investor_investments
          (id, organization_id, investor_id, project_id, amount, currency, equity_pct,
           invested_at, model_description, is_active, supabase_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const unmatched = new Set<string>();
      for (const r of rows) {
        try {
          const supabaseId = pickFirst(r, 'id', 'investment_id');
          if (!supabaseId) { result.investments.errors.push('Missing id'); continue; }
          if (checkExisting.get(orgId, supabaseId)) { result.investments.skipped++; continue; }

          const supabaseInvestorId = pickFirst(r, 'investor_id');
          const localInvestorId = investorBySupabaseId.get(supabaseInvestorId);
          if (!localInvestorId) {
            result.investments.errors.push(`Investor ${supabaseInvestorId} not found — import investors first`);
            continue;
          }

          const supabasePropId = pickFirst(r, 'property_id');
          const projectId = resolvePropId(supabasePropId, unmatched);
          if (!projectId) {
            result.investments.errors.push(`Property ${supabasePropId} not in propertyMap — import properties first`);
            continue;
          }

          if (input.dryRun) { result.investments.created++; continue; }
          const localId = `ivst_sb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          insert.run(
            localId, orgId, localInvestorId, projectId,
            num(pickFirst(r, 'amount')),
            pickFirst(r, 'currency') || 'EUR',
            num(pickFirst(r, 'equity_percentage', 'equity_pct')) || null,
            toIsoDate(pickFirst(r, 'date', 'invested_at')),
            pickFirst(r, 'model_description') || null,
            1,
            supabaseId,
          );
          result.investments.created++;
        } catch (e: any) {
          result.investments.errors.push(e.message);
        }
      }
      result.investments.unmatched_properties = [...unmatched];
    }

    // ─── PAYMENTS (= payouts) ───────────────────────────
    if (input.paymentsCsv) {
      const rows = parseCsv(input.paymentsCsv);
      result.payments.parsed = rows.length;
      const checkExisting = db.prepare(
        "SELECT id FROM investor_payouts WHERE organization_id = ? AND supabase_id = ?"
      );
      const insert = db.prepare(`
        INSERT INTO investor_payouts
          (id, organization_id, investor_id, project_id, amount, currency,
           paid_at, comment, supabase_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const unmatched = new Set<string>();
      for (const r of rows) {
        try {
          const supabaseId = pickFirst(r, 'id', 'payment_id');
          if (!supabaseId) { result.payments.errors.push('Missing id'); continue; }
          if (checkExisting.get(orgId, supabaseId)) { result.payments.skipped++; continue; }

          const supabaseInvestorId = pickFirst(r, 'investor_id');
          const localInvestorId = investorBySupabaseId.get(supabaseInvestorId);
          if (!localInvestorId) {
            result.payments.errors.push(`Investor ${supabaseInvestorId} not found`);
            continue;
          }

          const supabasePropId = pickFirst(r, 'property_id');
          const projectId = supabasePropId ? resolvePropId(supabasePropId, unmatched) : null;

          if (input.dryRun) { result.payments.created++; continue; }
          const localId = `payout_sb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          insert.run(
            localId, orgId, localInvestorId, projectId,
            num(pickFirst(r, 'amount')),
            pickFirst(r, 'currency') || 'EUR',
            toIsoDate(pickFirst(r, 'date', 'paid_at')),
            pickFirst(r, 'comment', 'note') || null,
            supabaseId,
          );
          result.payments.created++;
        } catch (e: any) {
          result.payments.errors.push(e.message);
        }
      }
      result.payments.unmatched_properties = [...unmatched];
    }

    // ─── METRICS ────────────────────────────────────────
    if (input.metricsCsv) {
      const rows = parseCsv(input.metricsCsv);
      result.metrics.parsed = rows.length;
      const insert = db.prepare(`
        INSERT INTO property_monthly_metrics
          (id, organization_id, project_id, year_month, occupancy_pct, revenue, supabase_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, year_month) DO UPDATE SET
          occupancy_pct = excluded.occupancy_pct,
          revenue = excluded.revenue,
          supabase_id = excluded.supabase_id,
          updated_at = datetime('now')
      `);
      const unmatched = new Set<string>();
      for (const r of rows) {
        try {
          const supabasePropId = pickFirst(r, 'property_id');
          const month = pickFirst(r, 'month', 'year_month');
          if (!supabasePropId || !month) { result.metrics.errors.push('Missing property_id or month'); continue; }
          const projectId = resolvePropId(supabasePropId, unmatched);
          if (!projectId) {
            result.metrics.errors.push(`Property ${supabasePropId} not in propertyMap`);
            continue;
          }
          if (input.dryRun) { result.metrics.created++; continue; }
          const supabaseId = pickFirst(r, 'id') || `${supabasePropId}_${month}`;
          const localId = `pmm_sb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          insert.run(
            localId, orgId, projectId, month,
            num(pickFirst(r, 'occupancy_rate', 'occupancy_pct')) || null,
            num(pickFirst(r, 'revenue')) || null,
            supabaseId,
          );
          result.metrics.created++;
        } catch (e: any) {
          result.metrics.errors.push(e.message);
        }
      }
      result.metrics.unmatched_properties = [...unmatched];
    }
  });

  // Always call tx() — dry-run mode short-circuits before each INSERT,
  // so counts populate but no rows are written.
  tx();

  return result;
}
