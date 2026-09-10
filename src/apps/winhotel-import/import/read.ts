/**
 * Читання витягу мосту: `<id>/<entity>.jsonl` → масив обʼєктів.
 *
 * Файлу немає — порожній масив, і це названо в лічильниках: сутність без
 * файла означає, що міст її не витягав, а не що в Winhotel її нуль.
 */
import fs from 'node:fs';
import path from 'node:path';

export function readJsonl<T>(dir: string, entity: string): { rows: T[]; present: boolean } {
  const file = path.join(dir, `${entity}.jsonl`);
  if (!fs.existsSync(file)) return { rows: [], present: false };
  const text = fs.readFileSync(file, 'utf8');
  const rows: T[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    rows.push(JSON.parse(t) as T);
  }
  return { rows, present: true };
}

export interface Aggregates {
  snapshot?: unknown;
  /** `delta` — вікно дат агента (міст пише його з `.ready`); інакше повний знімок. */
  mode?: 'delta' | string;
  window?: { from: string; to: string } | null;
  entities?: Record<string, number>;
  numbers?: Record<string, { label: string; value: string }>;
}

export function readAggregates(dir: string): Aggregates {
  const file = path.join(dir, 'aggregates.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Aggregates; } catch { return {}; }
}

/** Дата знімка — max RECHNUNG.DATUM_ZEIT з агрегатів; інакше — з рядка знімка. */
export function snapshotDate(agg: Aggregates, fallback: string | null): string | null {
  const v = agg.numbers?.snapshot_max_invoice_at?.value;
  if (v && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return fallback ? fallback.slice(0, 10) : null;
}
