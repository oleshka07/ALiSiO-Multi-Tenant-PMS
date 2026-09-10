/**
 * Перетворення рядка Winhotel у рядок JSON — один раз, у мосту.
 *
 * Що тут вирішується (docs/tasks/2026-09-10-block-winhotel-import.md §2.3,
 * IMPORT-PLAN.md §2.1):
 *
 *   байти → текст     charset NONE у базі = CP1252; декодуємо windows-1252,
 *                     і застосунок бачить уже UTF-8 («ÜF», не «\xDCF»);
 *   суми              домени NUMERIC(12,3) / NUMERIC(12,2) / DECIMAL(12,4):
 *                     isql через CAST віддає їх УЖЕ масштабованими — `141.000`,
 *                     `12.50` — тож рядок читається як десяткове число як є, без
 *                     жодного ділення. Перша редакція ділила на 1000, бо стаб
 *                     оголошував колонки BIGINT зі значенням 141000 (тип
 *                     ЗБЕРІГАННЯ з table-columns.tsv, не тип домену) — і живий
 *                     прохід віддав ніч за 141 € як 0.141 (рецензія А 10.09,
 *                     інваріант 28: стаб має форму живого зразка, не здогаду);
 *   дати              1899-12-30 (нуль Delphi) і все, що раніше 1900 → null;
 *                     2050-12-31 у довідниках — «без кінця», лишається як є:
 *                     це рішення застосунку, не мосту;
 *   прапорці          SMALLINT 0/1/-1 → false/true;
 *   порожній текст    → null: порожній рядок у Winhotel і є «немає».
 *
 * Формат вхідного потоку задають SQL-файли (`apps/winhotel-import/sql`):
 * поля розділені ASCII 31 (unit separator), записи — ASCII 30 (record
 * separator). Тому переноси рядків усередині тексту нічого не ламають, а
 * порожні рядки між записами, які друкує isql, відкидаються як пробіл на
 * початку запису. Заголовок `-- columns:` того самого файла каже, як звуться
 * поля і якого вони роду.
 */

export const FIELD_SEP = 0x1f;
export const RECORD_SEP = 0x1e;

const cp1252 = new TextDecoder('windows-1252');

export const TYPES = new Set(['int', 'float', 'amount', 'text', 'blob', 'date', 'ts', 'time', 'bool']);

/**
 * `-- columns: lnr:int, name1:text, betrag:amount` → [{name, type}].
 * Невідомий тип — помилка на старті, не тихе `text`.
 */
export function parseColumns(sql) {
  const m = sql.match(/^--\s*columns:\s*(.+)$/m);
  if (!m) throw new Error('у SQL-файлі немає рядка "-- columns:"');
  return m[1].split(',').map((part) => {
    const [name, type] = part.trim().split(':');
    if (!name || !type || !TYPES.has(type)) throw new Error(`колонка «${part.trim()}»: очікую name:type, type ∈ ${[...TYPES].join('|')}`);
    return { name, type };
  });
}

export function parseHeader(sql, key) {
  const m = sql.match(new RegExp(`^--\\s*${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

/** Дата раніше 1900 — нуль Delphi (1899-12-30) або сміття; обидва → null. */
export function convertDate(text) {
  if (!text) return null;
  const iso = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  if (iso < '1900-01-01') return null;
  return iso;
}

export function convertTimestamp(text) {
  if (!text) return null;
  const date = convertDate(text);
  if (!date) return null;
  const time = text.slice(11, 19);
  return /^\d{2}:\d{2}:\d{2}$/.test(time) ? `${date} ${time}` : date;
}

/**
 * Десятковий рядок домену як є: `141.000` → 141, `12.50` → 12.5, `-1.500` → -1.5,
 * `0.038` → 0.038. Знаків стільки, скільки дав домен; ділення НЕМАЄ.
 */
export function convertAmount(text) {
  if (text === '' || text == null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function convertValue(type, raw) {
  const text = typeof raw === 'string' ? raw : cp1252.decode(raw);
  switch (type) {
    case 'int': {
      if (text.trim() === '') return null;
      const n = Number(text);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'float': {
      if (text.trim() === '') return null;
      const n = Number(text);
      return Number.isFinite(n) ? n : null;
    }
    case 'amount': return convertAmount(text.trim());
    case 'bool': {
      if (text.trim() === '') return null;
      return Number(text) !== 0;
    }
    case 'date': return convertDate(text.trim());
    case 'ts': return convertTimestamp(text.trim());
    case 'time': return text.trim() ? text.trim().slice(0, 8) : null;
    case 'text':
    case 'blob': {
      const t = text.replace(/\s+$/, '');
      return t === '' ? null : t;
    }
    default: throw new Error(`невідомий тип поля «${type}»`);
  }
}

/**
 * Один запис (байти між двома ASCII 30) → обʼєкт. Кількість полів мусить
 * збігтись із заголовком: менше або більше — це не «пропустимо», а зламаний
 * SQL або зламаний вивід, і про це треба сказати.
 */
export function convertRecord(columns, record) {
  const fields = [];
  let start = 0;
  for (let i = 0; i < record.length; i += 1) {
    if (record[i] === FIELD_SEP) { fields.push(record.subarray(start, i)); start = i + 1; }
  }
  fields.push(record.subarray(start));
  if (fields.length !== columns.length) {
    throw new Error(`запис має ${fields.length} полів, а заголовок — ${columns.length}`);
  }
  const out = {};
  columns.forEach((col, i) => { out[col.name] = convertValue(col.type, fields[i]); });
  return out;
}

/**
 * Увесь вивід isql → масив обʼєктів. Пробіли й переноси ПЕРЕД записом — те,
 * що isql друкує між рядками результату; усередині запису вони значущі.
 */
export function convertOutput(columns, buffer) {
  const rows = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] !== RECORD_SEP) continue;
    let s = start;
    while (s < i && (buffer[s] === 0x0a || buffer[s] === 0x0d || buffer[s] === 0x20 || buffer[s] === 0x09)) s += 1;
    rows.push(convertRecord(columns, buffer.subarray(s, i)));
    start = i + 1;
  }
  // Хвіст після останнього роздільника — лише порожнеча; будь-що інше означає,
  // що isql обірвав вивід посередині запису.
  const tail = buffer.subarray(start).toString('latin1').trim();
  if (tail !== '') throw new Error(`після останнього запису лишився текст: «${tail.slice(0, 80)}»`);
  return rows;
}
