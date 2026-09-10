/**
 * Рядки `winhotel_snapshots` (0143) і читання маркерів мосту.
 *
 * Усе — під контекстом орендаря (`runWithOrganization` ставить приймальний
 * маршрут, `withOwner` — картка), і кожен запит ще й називає організацію
 * сам: на SQLite політик немає, а `id` знімка приходить із адреси
 * (`audit-by-id-scope`).
 *
 * Стан переводить лише застосунок: міст не має бази, він лишає маркери
 * (`storage.ts`), і `syncMarkers` при кожному відкритті картки читає їх і
 * записує в рядок. Так стан на екрані — завжди те, що є на томі, а не те,
 * що застосунок памʼятає.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getSql } from '@core/db/async';
import { snapshotPaths } from '../storage';

export type SnapshotStatus = 'received' | 'extracting' | 'extracted' | 'imported' | 'failed';
export type SnapshotMode = 'backup' | 'gbak' | 'copy';

export const SNAPSHOT_MODES: readonly SnapshotMode[] = ['backup', 'gbak', 'copy'];

export interface SnapshotRow {
  id: string;
  organization_id: string;
  taken_at: string | null;
  mode: SnapshotMode;
  sha256: string;
  size_bytes: number;
  status: SnapshotStatus;
  error: string | null;
  counts_json: string | null;
  received_at: string;
  imported_at: string | null;
}

const COLUMNS = 'id, organization_id, taken_at, mode, sha256, size_bytes, status, error, counts_json, received_at, imported_at';

/**
 * `counts_json` — JSONB на Postgres (драйвер віддає обʼєкт) і TEXT на SQLite
 * (рядок). Читачі бачать завжди рядок або null — форма одна на обидва рушії.
 */
function normalize(row: SnapshotRow | undefined): SnapshotRow | undefined {
  if (!row) return row;
  const raw = row.counts_json as unknown;
  if (raw !== null && raw !== undefined && typeof raw !== 'string') row.counts_json = JSON.stringify(raw);
  return row;
}

/** Текст відмови в рядку — для людини, не для стек-трейсу. */
const ERROR_TEXT_MAX = 500;

export function newSnapshotId(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `whs_${stamp}_${rand}`;
}

export async function findSnapshotBySha(organizationId: string, sha256: string): Promise<SnapshotRow | undefined> {
  return normalize(await getSql().row<SnapshotRow>(
    `SELECT ${COLUMNS} FROM winhotel_snapshots WHERE organization_id = ? AND sha256 = ?`,
    [organizationId, sha256],
  ));
}

export async function findSnapshot(organizationId: string, id: string): Promise<SnapshotRow | undefined> {
  return normalize(await getSql().row<SnapshotRow>(
    `SELECT ${COLUMNS} FROM winhotel_snapshots WHERE organization_id = ? AND id = ?`,
    [organizationId, id],
  ));
}

/**
 * Знімки, прийняті від початку поточної доби (UTC). Правило «один на добу»
 * рахує їх усі, крім тих, що впали: невдалий знімок не має блокувати
 * повторну спробу того ж дня.
 */
export async function snapshotsReceivedToday(organizationId: string, now = new Date()): Promise<SnapshotRow[]> {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const since = day.toISOString().slice(0, 19).replace('T', ' ');
  return getSql().rows<SnapshotRow>(
    `SELECT ${COLUMNS} FROM winhotel_snapshots WHERE organization_id = ? AND received_at >= ? AND status <> 'failed'`,
    [organizationId, since],
  );
}

export async function insertSnapshot(row: {
  id: string; organizationId: string; takenAt: string | null; mode: SnapshotMode; sha256: string; sizeBytes: number;
}): Promise<void> {
  await getSql().run(`
    INSERT INTO winhotel_snapshots (id, organization_id, taken_at, mode, sha256, size_bytes, status, received_at)
    VALUES (?, ?, ?, ?, ?, ?, 'received', CURRENT_TIMESTAMP)
  `, [row.id, row.organizationId, row.takenAt, row.mode, row.sha256, row.sizeBytes]);
}

export async function listSnapshots(organizationId: string, limit = 10): Promise<SnapshotRow[]> {
  const rows = await getSql().rows<SnapshotRow>(
    `SELECT ${COLUMNS} FROM winhotel_snapshots WHERE organization_id = ? ORDER BY received_at DESC, id DESC LIMIT ${Math.max(1, Math.min(100, limit | 0))}`,
    [organizationId],
  );
  return rows.map((r) => normalize(r)!);
}

export async function setSnapshotStatus(
  organizationId: string,
  id: string,
  status: SnapshotStatus,
  patch: { error?: string | null; countsJson?: string | null } = {},
): Promise<void> {
  const sets = ['status = ?'];
  const params: unknown[] = [status];
  if ('error' in patch) { sets.push('error = ?'); params.push(patch.error ? patch.error.slice(0, ERROR_TEXT_MAX) : null); }
  if ('countsJson' in patch) { sets.push('counts_json = ?'); params.push(patch.countsJson ?? null); }
  await getSql().run(
    `UPDATE winhotel_snapshots SET ${sets.join(', ')} WHERE organization_id = ? AND id = ?`,
    [...params, organizationId, id],
  );
}

/** Після імпорту: стан `imported`, час, і звіт імпорту поруч із числами мосту. */
export async function markImported(organizationId: string, id: string, report: unknown): Promise<void> {
  const row = await findSnapshot(organizationId, id);
  const base = row?.counts_json ? safeParse(row.counts_json) : {};
  const merged = JSON.stringify({ ...base, import: report });
  await getSql().run(
    `UPDATE winhotel_snapshots SET status = 'imported', error = NULL, counts_json = ?, imported_at = CURRENT_TIMESTAMP
      WHERE organization_id = ? AND id = ?`,
    [merged, organizationId, id],
  );
}

/** Імпорт триває: стан лишається `extracted`, фаза — у числах (CHECK статусів без «importing»). */
export async function markImporting(organizationId: string, id: string, running: boolean): Promise<void> {
  const row = await findSnapshot(organizationId, id);
  const base = (row?.counts_json ? safeParse(row.counts_json) : {}) as Record<string, unknown>;
  if (running) base.import = { phase: 'importing', startedAt: new Date().toISOString() };
  else if (base.import && (base.import as { phase?: string }).phase === 'importing') delete base.import;
  await getSql().run('UPDATE winhotel_snapshots SET counts_json = ? WHERE organization_id = ? AND id = ?', [JSON.stringify(base), organizationId, id]);
}

/** Імпорт відмовив: стан `extracted` лишається (знімок цілий), текст відмови — у `error`. */
export async function markImportFailed(organizationId: string, id: string, error: string): Promise<void> {
  const row = await findSnapshot(organizationId, id);
  const base = (row?.counts_json ? safeParse(row.counts_json) : {}) as Record<string, unknown>;
  delete base.import;
  await getSql().run(
    'UPDATE winhotel_snapshots SET error = ?, counts_json = ? WHERE organization_id = ? AND id = ?',
    [error.slice(0, ERROR_TEXT_MAX), JSON.stringify(base), organizationId, id],
  );
}

function safeParse(text: string): Record<string, unknown> {
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
}

function readText(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

/**
 * Прочитати маркери мосту для знімків, які ще в дорозі, і перевести стан.
 * Повертає, скільки рядків змінилось. Ніколи не кидає через файл: маркер,
 * якого не прочитати, — це «ще нічого», а не помилка картки.
 */
export async function syncMarkers(organizationId: string): Promise<number> {
  const pending = await getSql().rows<SnapshotRow>(
    `SELECT ${COLUMNS} FROM winhotel_snapshots WHERE organization_id = ? AND status IN ('received', 'extracting')`,
    [organizationId],
  );
  let changed = 0;
  for (const row of pending) {
    const p = snapshotPaths(organizationId, row.id);
    if (fs.existsSync(p.failed)) {
      const text = (readText(p.failed) ?? '').trim() || 'міст відмовив без тексту';
      await setSnapshotStatus(organizationId, row.id, 'failed', { error: text });
      changed += 1;
      continue;
    }
    if (fs.existsSync(p.extracted)) {
      const counts = readText(path.join(p.out, 'aggregates.json'));
      await setSnapshotStatus(organizationId, row.id, 'extracted', { error: null, countsJson: counts ? compactCounts(counts) : null });
      changed += 1;
      continue;
    }
    if (row.status === 'received' && fs.existsSync(p.extracting)) {
      await setSnapshotStatus(organizationId, row.id, 'extracting');
      changed += 1;
    }
  }
  return changed;
}

/**
 * У `counts_json` — лише числа мосту (`entities`, `numbers`), без сирих
 * текстів: агрегати не містять персональних даних за побудовою (SQL
 * повертає лічильники й суми), але колонка — не місце для довільного JSON,
 * який міст може колись розширити.
 */
function compactCounts(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { entities?: unknown; numbers?: unknown; snapshot?: unknown };
    return JSON.stringify({ winhotel: parsed.entities ?? {}, numbers: parsed.numbers ?? {}, snapshot: parsed.snapshot ?? null });
  } catch {
    return null;
  }
}
