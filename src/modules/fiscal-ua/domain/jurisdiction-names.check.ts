/**
 * Інваріант 22: країна не заходить у модель даних ЯДРА.
 *
 *   node src/modules/fiscal-ua/domain/jurisdiction-names.check.ts
 *
 * ── Що саме стверджується ───────────────────────────────────────────────
 *
 * «Ознака порушення: назва країни, її закону або її документа в імені
 * таблиці, колонки чи значення CHECK» (AGENTS.md, інваріант 22). Модуль
 * юрисдикції називати своє своїми словами МОЖЕ — на те він і модуль; ядро
 * не може, бо його колонки читає наступний клієнт з іншої країни, і вони
 * йому брешуть.
 *
 * ── Чому це властивість, а не візерунок (§3.2.1) ────────────────────────
 *
 * Перевірка читає ЖИВУ СХЕМУ, а не текст файлів. Візерунок довелося б
 * вгадувати: колонку можна додати в `CREATE`, в `ALTER`, через перебудову
 * таблиці, з іншим відступом, у міграції Postgres замість `db.ts`. Схема
 * відповідає на питання незалежно від того, як туди потрапила.
 *
 * ── І читає її НА ОБОХ рушіях ───────────────────────────────────────────
 *
 * Перша редакція знала лише `sqlite_master` + `PRAGMA table_info`, тобто
 * бачила рівно те, що створює `src/lib/db.ts`. Колонка, дописана ЛИШЕ в
 * міграцію Postgres, проходила б повз неї — а саме так у цьому продукті
 * зникали індекси (AGENTS §4: «індекс, дописаний лише в міграцію, є в
 * мігрованому середовищі й відсутній у нового клієнта»). Гейт, який стереже
 * одну з двох баз, — це той самий візерунок, тільки з іншого боку.
 *
 * Тому каталог питається за рушієм: `information_schema` на Postgres,
 * `sqlite_master` на SQLite. Під `npm run check` бігає перший варіант, під
 * `check:pg` — другий, і жоден із них не є повним сам по собі.
 *
 * ── Храповик, а не нуль ─────────────────────────────────────────────────
 *
 * Німецька фіскалізація СТАРША за це правило, і її колонки (`tse_*` у
 * `fin_folio_payments` і `fin_fiscal_settings`) справді порушують інваріант:
 * назва німецького пристрою стоїть у таблицях ядра. Вимагати нуля означало
 * б або переписати робочу касу заради стилю, або не мати гейта взагалі.
 * Тому стеля — це те, що було в день заведення гейта (19.09.2026); нове
 * порушення валить збірку, виправлене вимагає опустити стелю. Той самий
 * храповик, що `audit-by-id-scope` і `check-boundaries`.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');

/**
 * Простори імен, де країну називати МОЖНА: це і є модулі юрисдикції.
 *
 * Новий модуль юрисдикції додає сюди свій префікс разом зі своїми таблицями.
 * Рядок тут — заява «ця родина таблиць належить одній країні», і саме її
 * відсутність робить нову таблицю таблицею ЯДРА за замовчуванням.
 */
const JURISDICTION_NAMESPACES = ['prro_'];

/**
 * Слова, за якими впізнається країна, її закон або її документ.
 *
 * Токени цілі, після розбиття імені по `_`: інакше `created_at` збігся б з
 * «AT» (Австрія), а `update` — з «DE». Коротких двобуквених кодів тут немає
 * саме тому — вони невідрізнимі від звичайних слів.
 */
const JURISDICTION_TOKENS = new Set([
  // Україна
  'ukraine', 'ukrainian', 'prro', 'dps', 'pku', 'diia',
  // Німеччина
  'tse', 'tss', 'kassensichv', 'dsfinvk', 'fiskaly', 'elster', 'german', 'germany',
  // сусіди, яких ще немає в коді, — щоб не завелись непоміченими
  'ksef', 'efactura', 'czech', 'polish', 'austria', 'austrian', 'romania', 'romanian',
]);

/**
 * СТЕЛЯ на 19.09.2026 — спадок німецької каси, і нічого більше.
 *
 * Читати як «стільки місць ядра сьогодні називають чужу країну», а не як
 * «стільки дозволено». Зростання — червона збірка; зменшення вимагає
 * опустити стелю тут.
 */
const CEILING: Record<string, number> = {
  fin_folio_payments: 11,
  fin_fiscal_settings: 6,
};

function tokensOf(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function namesJurisdiction(name: string): boolean {
  return tokensOf(name).some((t) => JURISDICTION_TOKENS.has(t));
}

function isOwned(table: string): boolean {
  return JURISDICTION_NAMESPACES.some((p) => table.startsWith(p));
}

const sql = getSql();
const onPostgres = process.env.DB_DRIVER === 'postgres';

/** Таблиця, її колонки і текст її CHECK-ів — однаково з обох каталогів. */
interface TableShape { name: string; columns: string[]; checks: string }

async function shapes(): Promise<TableShape[]> {
  if (onPostgres) {
    const cols = await sql.rows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`, []);
    // Текст CHECK-ів — з каталогу обмежень; `pg_get_constraintdef` дає його
    // дослівно, разом із літералами списку значень.
    const checks = await sql.rows<{ table_name: string; def: string }>(
      `SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'c' AND n.nspname = 'public'`, []);
    const byTable = new Map<string, TableShape>();
    for (const c of cols) {
      const t = byTable.get(c.table_name) ?? { name: c.table_name, columns: [], checks: '' };
      t.columns.push(c.column_name);
      byTable.set(c.table_name, t);
    }
    for (const c of checks) {
      const t = byTable.get(c.table_name);
      if (t) t.checks += ` ${c.def}`;
    }
    return [...byTable.values()];
  }
  const tables = await sql.rows<{ name: string; sql: string }>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name", []);
  const out: TableShape[] = [];
  for (const t of tables) {
    const cols = await sql.rows<{ name: string }>(`PRAGMA table_info(${t.name})`, []);
    out.push({ name: String(t.name), columns: cols.map((c) => String(c.name)), checks: String(t.sql || '') });
  }
  return out;
}

const tables = await shapes();
assert.ok(tables.length > 50, `у схемі ${tables.length} таблиць — перевірка дивиться не туди`);

/** Порушення: (таблиця → скільки імен ядра називають країну). */
const found: Record<string, string[]> = {};
const note = (table: string, what: string) => {
  (found[table] ??= []).push(what);
};

for (const t of tables) {
  const table = t.name;
  if (isOwned(table)) continue;

  // 1. Імʼя самої таблиці.
  if (namesJurisdiction(table)) note(table, `таблиця ${table}`);

  // 2. Імена колонок — із живої схеми, не з тексту DDL.
  for (const c of t.columns) {
    if (namesJurisdiction(c)) note(table, `колонка ${table}.${c}`);
  }

  // 3. Значення CHECK — рядкові літерали в оголошенні обмеження.
  for (const m of t.checks.matchAll(/'([^']+)'/g)) {
    if (namesJurisdiction(m[1])) note(table, `значення CHECK «${m[1]}» у ${table}`);
  }
}

const problems: string[] = [];
for (const [table, places] of Object.entries(found)) {
  const ceiling = CEILING[table] ?? 0;
  if (places.length > ceiling) {
    problems.push(`${table}: ${places.length} > стелі ${ceiling}\n      ${places.join('\n      ')}`);
  }
}
for (const [table, ceiling] of Object.entries(CEILING)) {
  const now = found[table]?.length ?? 0;
  if (now < ceiling) {
    problems.push(`${table}: ${now} < стелі ${ceiling} — опустіть стелю в jurisdiction-names.check.ts`);
  }
}

if (problems.length) {
  console.log('');
  console.log('  ІНВАРІАНТ 22: країна в моделі даних ядра');
  for (const p of problems) console.log(`    ${p}`);
  console.log('');
  console.log('    Модуль юрисдикції називає своє своїми словами — додайте його');
  console.log('    префікс у JURISDICTION_NAMESPACES. Ядро — ні: перенесіть у модуль.');
  console.log('');
}
assert.strictEqual(problems.length, 0, 'інваріант 22 порушено — див. список вище');

const owned = tables.filter((t) => isOwned(t.name)).map((t) => t.name);
assert.ok(owned.length >= 2,
  'простір імен модуля юрисдикції порожній — або таблиці зникли, або префікс змінився й гейт стереже порожнечу');
console.log(`  ok  інваріант 22: ${tables.length} таблиць (${onPostgres ? 'Postgres' : 'SQLite'}), ${owned.length} у просторі модуля, спадок DE у стелі`);
console.log('країна живе в модулі: жодна нова колонка ядра не називає юрисдикції');
