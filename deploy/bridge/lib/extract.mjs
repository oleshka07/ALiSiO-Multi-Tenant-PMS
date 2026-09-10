/**
 * Відновити знімок і витягти сутності — те, що міст робить з одним файлом.
 *
 * ── Чому isql, а не node-firebird ────────────────────────────────────────
 *
 * Вибір із двох (задача §2.3). `node-firebird` говорить із СЕРВЕРОМ Firebird
 * по TCP: у контейнері довелося б тримати fbserver, відкривати порт, мати
 * пароль SYSDBA, і кожен із цих трьох — ще одна річ, яка ламається окремо
 * від решти. `gbak -c` + `isql-fb` працюють у вбудованому режимі: процес
 * відкриває файл бази сам, без сервера, без мережі, без пароля — рівно так,
 * як `docs/research/winhotel/extract.sh` пройшов справжні 407 МБ 10.09.2026.
 * Ціна — розбір текстового виводу; вона сплачена одним роздільником
 * (convert.mjs), і формат кожного файла видно очима в `apps/winhotel-import/sql`.
 *
 * ── Що виходить ──────────────────────────────────────────────────────────
 *
 *   <out>/<entity>.jsonl     по обʼєкту на рядок, уже в UTF-8, суми /1000
 *   <out>/aggregates.json    { snapshot, entities: {name: rows}, numbers: {key: text} }
 *
 * Відновлена база живе у робочій теці й видаляється в `finally` — і після
 * успіху, і після відмови: 400 МБ чужих гостей не мають лежати на диску
 * довше, ніж треба, щоб їх прочитати.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { RECORD_SEP, convertOutput, convertRecord, parseColumns, parseHeader } from './convert.mjs';

const GBAK = process.env.GBAK_BIN || 'gbak';
const ISQL = process.env.ISQL_BIN || 'isql-fb';

/** Запустити процес, зібрати stderr текстом; stdout — за бажанням у потік. */
function run(cmd, args, { stdoutTo = null, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', stdoutTo ? 'pipe' : 'ignore', 'pipe'] });
    const err = [];
    child.stderr.on('data', (d) => err.push(d));
    let piped = Promise.resolve();
    if (stdoutTo) piped = pipeline(child.stdout, ...stdoutTo);
    child.on('error', reject);
    child.on('close', (code) => {
      piped.then(() => resolve({ code, stderr: Buffer.concat(err).toString('latin1') }), reject);
    });
  });
}

/** `.gz` → файл; без `.gz` — копія. */
export async function unpack(archive, target) {
  const src = fs.createReadStream(archive);
  if (archive.endsWith('.gz')) {
    await pipeline(src, zlib.createGunzip(), fs.createWriteStream(target));
  } else {
    await pipeline(src, fs.createWriteStream(target));
  }
}

/**
 * gbak-бекап → база у `workDir/db.fdb`; режим `copy` — файл уже база.
 * Розрізнити можна й без режиму: перші байти бекапу gbak — не сторінка
 * Firebird; але агент режим називає, і ми йому віримо, а при невдачі
 * відновлення текст відмови каже, що саме не так.
 */
export async function restoreDatabase({ archive, mode, workDir, log = () => {} }) {
  fs.mkdirSync(workDir, { recursive: true });
  const raw = path.join(workDir, mode === 'copy' ? 'db.fdb' : 'snapshot.fbk');
  await unpack(archive, raw);
  if (mode === 'copy') {
    log(`copy: база ${(fs.statSync(raw).size / 1e6).toFixed(0)} МБ`);
    return raw;
  }
  const db = path.join(workDir, 'db.fdb');
  log(`gbak -c: ${(fs.statSync(raw).size / 1e6).toFixed(0)} МБ бекапу`);
  const res = await run(GBAK, ['-c', '-user', 'SYSDBA', raw, db]);
  fs.rmSync(raw, { force: true });
  if (res.code !== 0 || !fs.existsSync(db)) {
    throw new Error(`gbak -c відмовив (код ${res.code}): ${res.stderr.trim().split('\n').slice(-3).join(' | ')}`);
  }
  log(`база відновлена: ${(fs.statSync(db).size / 1e6).toFixed(0)} МБ`);
  return db;
}

/** Потік байтів isql → обʼєкти, по одному на ASCII 30. */
function recordStream(columns) {
  let rest = Buffer.alloc(0);
  return new Transform({
    readableObjectMode: true,
    transform(chunk, _enc, cb) {
      let buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      let start = 0;
      try {
        for (let i = 0; i < buf.length; i += 1) {
          if (buf[i] !== RECORD_SEP) continue;
          let s = start;
          while (s < i && (buf[s] === 0x0a || buf[s] === 0x0d || buf[s] === 0x20 || buf[s] === 0x09)) s += 1;
          this.push(convertRecord(columns, buf.subarray(s, i)));
          start = i + 1;
        }
      } catch (e) {
        cb(e);
        return;
      }
      rest = Buffer.from(buf.subarray(start));
      cb();
    },
    flush(cb) {
      const tail = rest.toString('latin1').trim();
      if (tail !== '') cb(new Error(`після останнього запису лишився текст: «${tail.slice(0, 80)}»`));
      else cb();
    },
  });
}

function jsonlStream(counter) {
  return new Transform({
    writableObjectMode: true,
    transform(row, _enc, cb) {
      counter.rows += 1;
      cb(null, `${JSON.stringify(row)}\n`);
    },
  });
}

/** Один SQL-файл сутності → `<out>/<entity>.jsonl`; повертає кількість рядків. */
export async function runEntity(dbPath, sqlFile, outDir, env) {
  const sql = fs.readFileSync(sqlFile, 'utf8');
  const entity = parseHeader(sql, 'entity') || path.basename(sqlFile, '.sql');
  const columns = parseColumns(sql);
  const counter = { rows: 0 };
  const target = path.join(outDir, `${entity}.jsonl`);
  const res = await run(ISQL, ['-q', '-b', '-user', 'SYSDBA', '-charset', 'NONE', '-i', sqlFile, dbPath], {
    stdoutTo: [recordStream(columns), jsonlStream(counter), fs.createWriteStream(target)],
    env,
  });
  if (res.code !== 0 || /Statement failed|Dynamic SQL Error|SQLSTATE/.test(res.stderr)) {
    throw new Error(`${entity}: isql відмовив (код ${res.code}): ${res.stderr.trim().split('\n').slice(0, 3).join(' | ')}`);
  }
  return { entity, rows: counter.rows };
}

/** Блоки `-- name:` з aggregates.sql → [{name, label, sql}]. */
export function parseAggregates(text) {
  const blocks = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const name = line.match(/^--\s*name:\s*(\S+)/);
    if (name) { cur = { name: name[1], label: '', sql: '' }; blocks.push(cur); continue; }
    if (!cur) continue;
    const label = line.match(/^--\s*label:\s*(.+)$/);
    if (label) { cur.label = label[1].trim(); continue; }
    if (line.startsWith('--') || !line.trim()) continue;
    cur.sql += `${line}\n`;
  }
  return blocks.filter((b) => b.sql.trim());
}

/** Кожен агрегат — окремий виклик isql; результат — обрізаний текст або `ERR`. */
export async function runAggregates(dbPath, aggFile, workDir, env) {
  const out = {};
  for (const block of parseAggregates(fs.readFileSync(aggFile, 'utf8'))) {
    const script = path.join(workDir, `agg-${block.name}.sql`);
    // EXECUTE BLOCK містить крапки з комою — isql потребує іншого термінатора.
    const body = /^\s*EXECUTE BLOCK/i.test(block.sql)
      ? `SET HEADING OFF;\nSET TERM ^ ;\n${block.sql.trim()}^\nSET TERM ; ^\n`
      : `SET HEADING OFF;\n${block.sql.trim()}${block.sql.trim().endsWith(';') ? '' : ';'}\n`;
    fs.writeFileSync(script, body);
    const chunks = [];
    const sink = new Transform({ transform(c, _e, cb) { chunks.push(c); cb(); } });
    const res = await run(ISQL, ['-q', '-user', 'SYSDBA', '-charset', 'NONE', '-i', script, dbPath], { stdoutTo: [sink], env });
    fs.rmSync(script, { force: true });
    const text = Buffer.concat(chunks).toString('latin1')
      .split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
    out[block.name] = { label: block.label, value: res.code !== 0 || /Statement failed|SQLSTATE/.test(res.stderr) || !text ? 'ERR' : text };
  }
  return out;
}

/**
 * Усі сутності + агрегати для однієї відновленої бази. Повертає те, що
 * лягає в `aggregates.json`.
 */
export async function extractAll({ dbPath, sqlDir, outDir, workDir, snapshot = null, log = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const env = { ...process.env, FIREBIRD_LOCK: workDir, FIREBIRD_TMP: workDir };
  const entities = {};
  const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql') && f !== 'aggregates.sql').sort();
  for (const f of files) {
    const t0 = Date.now();
    const { entity, rows } = await runEntity(dbPath, path.join(sqlDir, f), outDir, env);
    entities[entity] = rows;
    log(`${entity}: ${rows} рядків (${Date.now() - t0} мс)`);
  }
  const aggFile = path.join(sqlDir, 'aggregates.sql');
  const numbers = fs.existsSync(aggFile) ? await runAggregates(dbPath, aggFile, workDir, env) : {};
  const result = { snapshot, extractedAt: new Date().toISOString(), entities, numbers };
  fs.writeFileSync(path.join(outDir, 'aggregates.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/**
 * Повний прохід одного знімка: відновити → витягти → прибрати базу.
 * Робоча тека видаляється завжди.
 */
export async function processSnapshot({ archive, mode, sqlDir, outDir, workDir, snapshot = null, log = () => {} }) {
  try {
    const dbPath = await restoreDatabase({ archive, mode, workDir, log });
    return await extractAll({ dbPath, sqlDir, outDir, workDir, snapshot, log });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Дельта агента (задача 8 §3) ─────────────────────────────────────────
//
// Агент на сервері готелю раз на 15 хв читає isql-ом лише броні з заїздом
// або виїздом у вікні дат і шле СИРИЙ вивід одним gzip-пакетом: секції
// розділені ASCII 29 (group separator), перший рядок секції — імʼя сутності,
// далі — той самий формат, що й у повного витягу (поля ASCII 31, записи
// ASCII 30). Колонки беруться з SQL-файла тієї самої сутності в ЦЬОМУ мосту:
// шаблони агента (`apps/winhotel-agent/sql-delta/`) мають той самий рядок
// `-- columns:`, і гейт це стереже. Бази тут немає — тільки перетворення.

export const GROUP_SEP = 0x1d;

/** Розкласти пакет дельти на секції {entity, bytes}. */
export function splitDeltaBundle(buffer) {
  const sections = [];
  let start = 0;
  while (start < buffer.length) {
    if (buffer[start] !== GROUP_SEP) throw new Error(`секція дельти не починається з ASCII 29 (зміщення ${start})`);
    let end = start + 1;
    while (end < buffer.length && buffer[end] !== GROUP_SEP) end += 1;
    const part = buffer.subarray(start + 1, end);
    const nl = part.indexOf(0x0a);
    const entity = (nl >= 0 ? part.subarray(0, nl) : part).toString('latin1').trim().replace(/\r$/, '');
    if (!/^[a-z_]+$/.test(entity)) throw new Error(`імʼя сутності в дельті не годиться: «${entity.slice(0, 40)}»`);
    sections.push({ entity, bytes: nl >= 0 ? part.subarray(nl + 1) : Buffer.alloc(0) });
    start = end;
  }
  return sections;
}

/**
 * Пакет дельти → `<out>/<entity>.jsonl` + `aggregates.json` з `mode: "delta"` і
 * вікном. Без вікна — відмова: дельта без меж нічого не означає для імпорту.
 */
export async function processDelta({ archive, sqlDir, outDir, window, snapshot = null, log = () => {} }) {
  if (!window || !window.from || !window.to) throw new Error('дельта без вікна дат (window.from/window.to) — імпортувати нема як');
  fs.mkdirSync(outDir, { recursive: true });
  const raw = archive.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(archive)) : fs.readFileSync(archive);
  const entities = {};
  for (const { entity, bytes } of splitDeltaBundle(raw)) {
    const sqlFile = path.join(sqlDir, `${entity}.sql`);
    if (!fs.existsSync(sqlFile)) throw new Error(`дельта несе сутність «${entity}», якої міст не знає`);
    const columns = parseColumns(fs.readFileSync(sqlFile, 'utf8'));
    const rows = convertOutput(columns, bytes);
    fs.writeFileSync(path.join(outDir, `${entity}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
    entities[entity] = rows.length;
    log(`${entity}: ${rows.length} рядків (дельта)`);
  }
  if (!('bookings' in entities)) throw new Error('дельта без секції bookings — це не дельта броней');
  const result = { snapshot, mode: 'delta', window, extractedAt: new Date().toISOString(), entities, numbers: {} };
  fs.writeFileSync(path.join(outDir, 'aggregates.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
