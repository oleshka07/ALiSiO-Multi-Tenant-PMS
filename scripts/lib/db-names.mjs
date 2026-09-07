/**
 * Чи резолвиться ім'я, яке гейт збирається прибирати — питається НАПЕРЕД,
 * одним запитом до каталогу, а не ловиться винятком з живого `DELETE`.
 *
 * Навіщо наперед (Р10.13). Прибирання по броні виконується всередині циклу по
 * бронях, тож на чистій базі перший `cleanup()` не виконує його ВЗАГАЛІ: два
 * мертвих імені в `check-routes-live` ловилися лише тоді, коли прогін дійшов
 * до створення броні. Ім'я, яке гейт назве, але жодного разу не виконає, так і
 * лишиться неперевіреним — тому питати треба каталог, а не виняток.
 *
 * Навіщо каталог, а не текст помилки (Р10.12). Класифікатор по тексту
 * `does not exist` ловить не лише relation і column: «role … does not exist»,
 * «database … does not exist», «prepared statement … does not exist» (класика
 * під пулером) дали б тверде червоне з написом «гейт прибирає те, чого немає».
 * Другий випадок не гіпотетичний — застаріла локальна база на 114 таблиць
 * замість 121 падала б саме так, з неправдивою причиною.
 *
 * Один запит на обидва двигуни, без інтерполяції імен: на Postgres
 * `information_schema.columns`, на SQLite — табличні функції `pragma_table_info`.
 */

const isPostgres = () => process.env.DB_DRIVER === 'postgres';

/** Усі пари «таблиця, колонка» поточної бази — одним запитом. */
async function catalogue(sql) {
  const rows = isPostgres()
    ? await sql.rows(
      `SELECT table_name AS t, column_name AS c
         FROM information_schema.columns
        WHERE table_schema = 'public'`)
    : await sql.rows(
      `SELECT m.name AS t, p.name AS c
         FROM sqlite_master m
         JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table'`);

  const tables = new Set();
  const columns = new Set();
  for (const r of rows) {
    tables.add(r.t);
    columns.add(`${r.t}.${r.c}`);
  }
  return { tables, columns };
}

/**
 * Предикат «ця база знає таке ім'я» — ОДИН запит до каталогу на весь прогін.
 *
 * Повертає `has(table, column?)`: без колонки питається лише наявність
 * таблиці.
 */
export async function nameResolver(sql) {
  const { tables, columns } = await catalogue(sql);
  return (table, column) => (column ? columns.has(`${table}.${column}`) : tables.has(table));
}

/**
 * Які з названих імен предикат не знає — рядками, готовими до друку.
 *
 * `wanted` — список `{ table, column }`; `column` необов'язкова. Порожній
 * список означає, що прибирання називає лише те, що в базі є.
 */
export function missingFrom(has, wanted) {
  const missing = [];
  for (const { table, column } of wanted) {
    if (!has(table)) missing.push(`таблиці ${table} немає в цій базі`);
    else if (column && !has(table, column)) missing.push(`у ${table} немає колонки ${column}`);
  }
  return missing;
}

/**
 * Чи ця відмова означає «об'єкт не резолвиться в цій базі».
 *
 * За КОДОМ, не за текстом: Postgres `42P01` (undefined_table) і `42703`
 * (undefined_column); SQLite коду не дає, тому там лишається текст, але вузький
 * — саме дві його форми, а не будь-яке `does not exist`.
 */
export function isUnresolvedObject(e) {
  if (e?.code === '42P01' || e?.code === '42703') return true;
  return /no such (table|column)\b/i.test(e?.message || '');
}
