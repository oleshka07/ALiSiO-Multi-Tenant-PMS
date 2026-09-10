/**
 * Де лежать знімки Winhotel — і як називаються маркери, якими застосунок і
 * міст розмовляють через том.
 *
 * ── Чому файли, а не HTTP між контейнерами ──────────────────────────────
 *
 * Міст (`deploy/bridge/`) не має мережі взагалі (`network_mode: none`) і не
 * знає Postgres. Єдине спільне в нього із застосунком — том
 * `winhotel-snapshots`. Тому протокол — маркери поруч із файлом:
 *
 *   <org>/<id>.fbk.gz     знімок (gzip поверх .fbk або .fdb)
 *   <org>/<id>.ready      застосунок: файл цілий, sha256 звірено — можна брати
 *   <org>/<id>.extracting міст: узяв у роботу
 *   <org>/<id>/*.jsonl    міст: по файлу на сутність (apps/winhotel-import/sql)
 *   <org>/<id>/aggregates.json  міст: лічильники й контрольні числа
 *   <org>/<id>.extracted  міст: усе на місці
 *   <org>/<id>.failed     міст: текст відмови (наш текст, не стек)
 *
 * `.ready` пишеться ОСТАННІМ, після перейменування з `.part`: міст, який
 * побачить лише `.fbk.gz`, нічого не робить, тож пів-завантаженого файла він
 * не відновлює. Застосунок читає маркери мосту при кожному відкритті картки
 * (`snapshots.repo.ts` → `syncMarkers`) і переводить стан рядка.
 *
 * Корінь — `WINHOTEL_SNAPSHOT_DIR`, інакше `<дані>/winhotel`: у контейнері це
 * `/app/data/winhotel` (том у compose), локально — `data/winhotel`; гейт
 * ставить `ALISIO_DATA_DIR` у тимчасову теку і дістає її ж.
 */
import fs from 'node:fs';
import path from 'node:path';

export function snapshotRoot(): string {
  if (process.env.WINHOTEL_SNAPSHOT_DIR) return path.resolve(process.env.WINHOTEL_SNAPSHOT_DIR);
  const data = process.env.ALISIO_DATA_DIR
    ? path.resolve(process.env.ALISIO_DATA_DIR)
    : path.join(process.cwd(), 'data');
  return path.join(data, 'winhotel');
}

/**
 * Ідентифікатори стають іменами файлів, тому — лише те, що не може вийти за
 * межі теки. Організація приходить із бази, id знімка — з нашого генератора;
 * перевірка тут, щоб жоден інший шлях (параметр адреси) не зробив із них
 * `../`.
 */
const SAFE = /^[A-Za-z0-9_-]{1,120}$/;

export function assertSafeSegment(value: string, what: string): string {
  if (!SAFE.test(value)) throw new Error(`${what} «${value.slice(0, 40)}» не годиться для імені файла`);
  return value;
}

export interface SnapshotPaths {
  dir: string;
  /** Файл під час завантаження — перейменовується в `archive` лише цілим. */
  part: string;
  archive: string;
  ready: string;
  extracting: string;
  extracted: string;
  failed: string;
  /** Тека з `<entity>.jsonl` і `aggregates.json`. */
  out: string;
}

export function snapshotPaths(organizationId: string, snapshotId: string): SnapshotPaths {
  const dir = path.join(snapshotRoot(), assertSafeSegment(organizationId, 'організація'));
  const base = path.join(dir, assertSafeSegment(snapshotId, 'знімок'));
  return {
    dir,
    part: `${base}.part`,
    archive: `${base}.fbk.gz`,
    ready: `${base}.ready`,
    extracting: `${base}.extracting`,
    extracted: `${base}.extracted`,
    failed: `${base}.failed`,
    out: base,
  };
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Прибрати все, що лишилось від знімка, який не прийнято. Ніколи не кидає. */
export function discardSnapshotFiles(p: SnapshotPaths): void {
  for (const f of [p.part, p.archive, p.ready]) {
    try { fs.rmSync(f, { force: true }); } catch { /* нема — і не треба */ }
  }
}
