/**
 * Перепустка, відчинена лише НОВІЙ базі, не відчиняє нічого.
 *
 *   node scripts/check-public-token-policy.mjs [--strict]
 *
 * ── Що сталося 12.09.2026 ────────────────────────────────────────────────
 *
 * Оператор видав ключ гостьового застосунку, відкрив `/stay/<ключ>` і дістав
 * 404 на живій беті. Ключ правильний, вимикач увімкнений, код розгорнутий.
 *
 * Бракувало ПОЛІТИКИ. `properties` читається публічною перепусткою
 * (інваріант 14), і рядок має відчинити сама політика. Дзеркало було додано
 * в `PUBLIC_TOKEN_READ` генератора — тобто НОВА база політику дістала, — а
 * міграції не було, тож бета й прод лишились зі старою назавжди.
 *
 * ── Чому цього не бачив `check-schema-drift` ─────────────────────────────
 *
 * Дві причини, і друга важливіша:
 *
 *   1. він порівнює колонки, індекси, таблиці й констрейнти — політик серед
 *      них немає;
 *   2. навіть із політиками він цього не побачив би: ОБИДВІ його бази
 *      починаються з `schema.sql`, тож те, що є в `schema.sql` і чого не
 *      приносить жодна міграція, присутнє в обох. Напрямок «schema.sql має
 *      щось, чого міграція не дає» — названий у його шапці метою — не
 *      виявляється за побудовою (INC-210).
 *
 * ── Що стверджує ЦЕЙ гейт ────────────────────────────────────────────────
 *
 * Не візерунок, а властивість: кожен рядок `PUBLIC_TOKEN_READ` мусить мати
 * міграцію, яка ставить цю політику. Бо `schema.sql` обслуговує лише того,
 * хто заводиться ЗАВТРА, а перепустка потрібна й тим, хто вже живе.
 *
 * Гейт не питає бази — він читає генератор і міграції. Живу базу питає
 * `check-deployed-db.mjs`, і питання там інше: чи всі міграції докотились.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

const gen = fs.readFileSync(path.join(ROOT, 'scripts/pg-schema.mjs'), 'utf8');
const start = gen.indexOf('const PUBLIC_TOKEN_READ');
if (start < 0) {
  console.error('✗ у scripts/pg-schema.mjs немає PUBLIC_TOKEN_READ — гейт не знає, що перевіряти');
  process.exit(1);
}
const end = gen.indexOf('\n]);', start);
if (end < 0) {
  console.error('✗ PUBLIC_TOKEN_READ не закрито — файл прочитано не до кінця');
  process.exit(1);
}
// Коментарі геть: усередині мапи вони згадують і таблиці, і колонки, і
// перевірка рахувала б власну документацію (AGENTS §4).
const body = gen.slice(start, end)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const pairs = [...body.matchAll(/\[\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\]/g)]
  .map((m) => ({ table: m[1], column: m[2] }));

if (pairs.length === 0) {
  console.error('✗ у PUBLIC_TOKEN_READ не знайдено жодної пари — розбір зламався');
  process.exit(1);
}

const dir = path.join(ROOT, 'db/postgres/migrations');
const migrations = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));

/**
 * Якою ця політика лишається ПІСЛЯ всіх міграцій — і чи відчиняє вона перепустку.
 *
 * Не «хоч одна міграція її ставить»: міграції накочуються по черзі, і остання,
 * що торкнулась політики, перекриває всі попередні. Гейт, який радів би
 * ПЕРШОМУ входженню, був би зелений і тоді, коли пізніша міграція перестворила
 * політику без умови токена — тобто стеріг би візерунок «десь колись
 * написано», а не властивість «база в кінці має дірку» (§3.2.1).
 *
 * Тому проходимо всі файли в порядку накочування й лишаємо ОСТАННЄ слово:
 * `CREATE POLICY` кладе тіло, `DROP POLICY` без наступного `CREATE` у тому ж
 * файлі лишає порожньо.
 */
function finalPolicy(table) {
  const stmt = new RegExp(
    String.raw`(?:CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?${table}_tenant"?[\s\S]*?;`, 'gi');
  let last = null;   // { body, file } або null, якщо політику знесли й не повернули
  for (const m of migrations) {
    for (const hit of m.text.match(stmt) ?? []) {
      last = /^\s*DROP/i.test(hit) ? null : { body: hit, file: m.name };
    }
  }
  return last;
}

const missing = [];
const found = [];
for (const { table, column } of pairs) {
  const last = finalPolicy(table);
  if (last && last.body.includes(column) && last.body.includes('app.public_token')) {
    found.push(`${table}.${column} ← ${last.file}`);
  } else {
    missing.push({ table, column, why: last ? 'остання міграція політики не має цієї умови' : 'жодна міграція не ставить цієї політики' });
  }
}

if (missing.length > 0) {
  console.error('\n✗ ПЕРЕПУСТКА Є ЛИШЕ В НОВІЙ БАЗІ — середовище, яке вже живе, її не дістане:\n');
  for (const { table, column, why } of missing) {
    console.error(`  ${table}.${column} — у PUBLIC_TOKEN_READ є: ${why}`);
  }
  console.error('\n  `schema.sql` обслуговує лише того, хто заводиться завтра. Бета й прод');
  console.error('  створені давно: без міграції їхня політика лишиться старою назавжди,');
  console.error('  і читання за перепусткою віддаватиме НУЛЬ РЯДКІВ — мовчки.');
  console.error('\n  Зразок: db/postgres/migrations/0418-*.sql (DROP POLICY IF EXISTS + CREATE).');
  if (strict) process.exit(1);
} else {
  console.log(`public-token: ${found.length} перепусток, кожна має міграцію`);
  for (const f of found) console.log(`  ${f}`);
}
