/**
 * `winhotel_refs` і `winhotel_staging` (0144) — памʼять імпорту.
 *
 * Refs — єдиний спосіб, яким повторний імпорт знаходить свій рядок: не за
 * імʼям, не за датами, а за (сутність, LNR). `fingerprint` — відбиток полів,
 * з яких рядок зроблено: збігся — рядок не чіпається взагалі; розійшовся —
 * оновлюється те, для чого є двері, або лягає в staging як «змінено» там, де
 * дверей немає.
 *
 * Staging — те, що прийшло з Winhotel, а покласти в ядро немає куди
 * (`CORE-GAPS.md`) або немає дверей у фасаді. Повний JSON і причина словом;
 * лічильник по причинах іде в `counts_json` знімка. Один рядок на (сутність,
 * LNR): новий знімок оновлює, не дублює.
 *
 * Усе — під контекстом орендаря і з `organization_id` у кожному запиті.
 */
import crypto from 'node:crypto';
import { getSql } from '@core/db/async';

export interface RefRow {
  entity: string;
  winhotel_lnr: number;
  our_id: string;
  fingerprint: string | null;
}

/** Відбиток значень — стабільний JSON, sha256 у hex. */
export function fingerprintOf(value: unknown): string {
  const stable = JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 32);
}

export async function refsOf(organizationId: string, entity: string): Promise<Map<number, RefRow>> {
  const rows = await getSql().rows<RefRow>(
    'SELECT entity, winhotel_lnr, our_id, fingerprint FROM winhotel_refs WHERE organization_id = ? AND entity = ?',
    [organizationId, entity],
  );
  return new Map(rows.map((r) => [Number(r.winhotel_lnr), { ...r, winhotel_lnr: Number(r.winhotel_lnr) }]));
}

export async function findRef(organizationId: string, entity: string, lnr: number): Promise<RefRow | undefined> {
  const row = await getSql().row<RefRow>(
    'SELECT entity, winhotel_lnr, our_id, fingerprint FROM winhotel_refs WHERE organization_id = ? AND entity = ? AND winhotel_lnr = ?',
    [organizationId, entity, lnr],
  );
  return row ? { ...row, winhotel_lnr: Number(row.winhotel_lnr) } : undefined;
}

export async function putRef(organizationId: string, entity: string, lnr: number, ourId: string, fingerprint: string | null): Promise<void> {
  const sql = getSql();
  const updated = await sql.run(
    `UPDATE winhotel_refs SET our_id = ?, fingerprint = ?, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ? AND entity = ? AND winhotel_lnr = ?`,
    [ourId, fingerprint, organizationId, entity, lnr],
  );
  if (updated.changes > 0) return;
  await sql.run(
    `INSERT INTO winhotel_refs (id, organization_id, entity, winhotel_lnr, our_id, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`whr_${crypto.randomBytes(12).toString('hex')}`, organizationId, entity, lnr, ourId, fingerprint],
  );
}

export async function countRefs(organizationId: string, entity?: string): Promise<number> {
  const row = entity
    ? await getSql().row<{ n: number }>('SELECT COUNT(*) AS n FROM winhotel_refs WHERE organization_id = ? AND entity = ?', [organizationId, entity])
    : await getSql().row<{ n: number }>('SELECT COUNT(*) AS n FROM winhotel_refs WHERE organization_id = ?', [organizationId]);
  return Number(row?.n ?? 0);
}

export async function stage(
  organizationId: string,
  snapshotId: string | null,
  entity: string,
  lnr: number,
  reason: string,
  payload: unknown,
): Promise<void> {
  const sql = getSql();
  const json = JSON.stringify(payload);
  const updated = await sql.run(
    `UPDATE winhotel_staging SET snapshot_id = ?, reason = ?, payload_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ? AND entity = ? AND winhotel_lnr = ?`,
    [snapshotId, reason, json, organizationId, entity, lnr],
  );
  if (updated.changes > 0) return;
  await sql.run(
    `INSERT INTO winhotel_staging (id, organization_id, snapshot_id, entity, winhotel_lnr, reason, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`whs_${crypto.randomBytes(12).toString('hex')}`, organizationId, snapshotId, entity, lnr, reason, json],
  );
}

export interface StagingCount { entity: string; reason: string; n: number }

export async function stagingCounts(organizationId: string): Promise<StagingCount[]> {
  const rows = await getSql().rows<StagingCount>(
    'SELECT entity, reason, COUNT(*) AS n FROM winhotel_staging WHERE organization_id = ? GROUP BY entity, reason ORDER BY entity, reason',
    [organizationId],
  );
  return rows.map((r) => ({ ...r, n: Number(r.n) }));
}

export async function stagedLnrs(organizationId: string, entity: string): Promise<Set<number>> {
  const rows = await getSql().rows<{ winhotel_lnr: number }>(
    'SELECT winhotel_lnr FROM winhotel_staging WHERE organization_id = ? AND entity = ?',
    [organizationId, entity],
  );
  return new Set(rows.map((r) => Number(r.winhotel_lnr)));
}
