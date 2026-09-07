/**
 * Валюта береться з готелю, а не вигадується.
 *
 *   node src/core/currency.check.ts
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * `row.currency || 'CZK'` — 77 місць на момент написання. Кожне з них каже:
 * «якщо база не назвала валюти, це чеські крони». Для чеського готелю це
 * непомітно; для німецького це сума в євро з підписом CZK. 4200 EUR і
 * 4200 CZK — різні гроші й різні зобовʼязання, а на фактурі ще й різний
 * податок.
 *
 * Гейт — храповик, а не заборона: 77 місць не виправляються одним комітом,
 * і збірка, яку ніхто не може полагодити, — це збірка, яку вчаться
 * ігнорувати (та сама причина, чому в CI немає `npm run lint`). Стеля стоїть
 * тут-таки; ріст валить збірку, зменшення вимагає опустити стелю.
 *
 * ── Чого гейт НЕ чіпає ──────────────────────────────────────────────────
 *
 * `'CZK'` як значення у списку валют, у тесті чи в назві колонки — не вада.
 * Вада — саме ЗАПАСНЕ значення: `|| 'CZK'`, `?? 'CZK'`, `= 'CZK'` там, де
 * зліва стоїть прочитане з бази.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Скільки запасних валют лишилось. Нуль.
 *
 * 77 → 70 → 69 → 0. Храповик зробив свою роботу і на цьому закінчився:
 * стеля в нулі — це вже не храповик, а заборона. Наступне `|| 'CZK'` валить
 * збірку, і це правильно, бо тепер його нема звідки взяти «як у сусідів».
 *
 * ── Звідки валюта береться тепер ────────────────────────────────────────
 *
 * - **Клієнт** — `useHotelCurrency()` (`ui/hooks/useCurrentUser`). Порожньо,
 *   поки `/api/auth/me` не відповів: сума без підпису читається як
 *   завантаження, з ЧУЖИМ підписом — як факт.
 * - **Сервер** — `organizationCurrency(orgId)` з `@core/currency`. Кидає,
 *   коли валюти немає: суму невідомої валюти краще не пустити далі.
 * - **Рядок із бази** — просто колонка. `invoices`, `fin_operations`,
 *   `reservations`, `booking_sites`, `gift_cards`, `additional_services`:
 *   у всіх `currency` це `TEXT NOT NULL`, тож `|| 'CZK'` там не спрацьовував
 *   ніколи. Він не був захистом — він виглядав як рішення, і читач вірив,
 *   що порожня валюта буває.
 * - **Створення готелю** — `provisionOrganization` ВІДМОВЛЯЄ без валюти,
 *   як і без мови. Раніше `input.currency || 'CZK'` робив чеським кожен
 *   готель, заведений без `--currency`.
 *
 * ── Що знайшлось дорогою ────────────────────────────────────────────────
 *
 * `widget-config-public` читав `property.default_currency`, а такої колонки
 * в `properties` немає — запит іде через `SELECT *`, поле приходило
 * undefined, і запасне значення спрацьовувало ЗАВЖДИ. Публічний віджет
 * КОЖНОГО готелю підписував ціни кронами. Це не косметика: гість бачив
 * число, за яким збирався платити, з чужою валютою.
 */
const CEILING = 0;

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist']);
const files: string[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.check.ts')) files.push(p);
  }
})('src');

/** Запасне значення валюти: те, що підставляється, коли база промовчала. */
const FALLBACK = /(\|\||\?\?)\s*['"][A-Z]{3}['"]/g;

/**
 * Проза — не код.
 *
 * Без цього перевірка рахувала власний коментар: у документації вгорі стоїть
 * `row.currency || 'CZK'` як приклад того, що ловиться, — і сама себе ловила.
 * Той самий урок, що й у `check-boundaries.mjs`: «Prose is not SQL».
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const found: string[] = [];
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripComments(raw);
  for (const m of src.matchAll(FALLBACK)) {
    const line = src.slice(0, m.index!).split('\n').length;
    // Контекст рядка: `|| 'CZK'` після слова, яке не про валюту (наприклад
    // `|| 'USD'` у списку кодів країн), сюди не потрапляє — але щоб не
    // вгадувати, дивимось, чи в рядку взагалі йдеться про валюту.
    const text = src.split('\n')[line - 1] ?? '';
    if (!/currenc|Currenc|CURRENC/.test(text)) continue;
    found.push(`${file}:${line}  ${text.trim().slice(0, 96)}`);
  }
}

assert.ok(found.length <= CEILING,
  `запасних валют ${found.length}, стеля ${CEILING} — НОВЕ ЗАПАСНЕ ЗНАЧЕННЯ.\n` +
  '    На сервері валюта береться з organizationCurrency() (@core/currency),\n' +
  '    на клієнті — з useHotelCurrency() (ui/hooks/useCurrentUser), а з рядка\n' +
  '    бази просто читається: колонка `currency` скрізь NOT NULL.\n' +
  '    Відсутність валюти — відмова, а не крони. Нові:\n    ' +
  found.slice(CEILING).join('\n    '));

// Опускати вже нікуди: нуль — дно храповика. Гілка лишається на випадок,
// якщо стелю колись піднімуть свідомо (і тоді її треба буде повернути в нуль).
if (found.length < CEILING) {
  assert.fail(
    `запасних валют ${found.length}, стеля ${CEILING} — стало КРАЩЕ.\n` +
    `    Опустіть CEILING у src/core/currency.check.ts до ${found.length},\n` +
    '    щоб прогрес не відкотився мовчки.');
}
console.log(`  ok  запасних валют ${found.length} (стеля ${CEILING}) — не зросло`);

// ── Акцесор відмовляє, а не вгадує ──────────────────────────────────────
const currency = fs.readFileSync('src/core/currency.ts', 'utf8');
// Форму НЕ фіксуємо: 07.09 тут стояв літеральний `throw new Error(`, і гейт
// почервонів на правці, яка нічого не зламала, — відмова стала `refuse(…, 409)`,
// щоб `catch` міг відрізнити її від помилки драйвера (Ц43). Твердження про
// властивість: акцесор ЗАКІНЧУЄТЬСЯ відмовою з тим самим текстом, а яким саме
// словом вона кидається — не предмет цього гейта. Поведінку (виклик справді
// відхиляється, і відхилення розпізнається як названа відмова) доводить
// `currency.rates.check.ts`, там є жива база.
assert.ok(/(throw new Error|refuse)\(\s*\n?\s*`?У організації/.test(currency),
  'organizationCurrency() має відмовляти, коли валюти немає — підставити будь-що означає пустити далі суму невідомої валюти');
assert.ok(!/(\|\||\?\?)\s*['"][A-Z]{3}['"]/.test(stripComments(currency)),
  'у самому core/currency.ts зʼявилось запасне значення валюти — це те, що він мав прибрати');
console.log('  ok  organizationCurrency() відмовляє замість вгадування');

// ── Курс не округлюється до копійок ─────────────────────────────────────
//
// `money(rate)` за замовчуванням дає два знаки, а колонка — NUMERIC(18,8).
// Курс 24.53750000 став би 24.54: на рахунку в 300 000 це тридцять крон з
// нічого. Інваріант 9 — про суму, не про курс.
const handlers = fs.readFileSync('src/modules/properties/api/currency.handlers.ts', 'utf8');
assert.ok(/money\(rate, 8\)/.test(currency),
  'ручний курс округлюється не до 8 знаків — колонка NUMERIC(18,8), і два знаки її псують');
console.log('  ok  ручний курс лягає з тією ж точністю, що й автоматичний');

// ── Один курс, а не два ─────────────────────────────────────────────────
//
// Спокуса тримати ручний курс колонкою в organization_currencies велика. Два
// джерела курсу розходяться так само тихо, як чотири цикли по днях колись
// давали чотири різні ціни за ніч (інваріант 16).
//
// Читаються ВСІ міграції, а не одна.
//
// Тут стояв рівно файл `0041`, і це трималось на прозі, а не на гейті:
// міграцію `0112` він не побачив би взагалі. До того ж регулярка
// `\brate\b` не спрацьовує на `fixed_rate` — межі слова перед `rate` там
// немає. Тобто рішення §2.2.1 стерегли слова «курс живе лише в
// finance_exchange_rates», а перевіряв гейт зовсім інше (О7, рецензія раунду
// 4). Тепер: будь-яка міграція, яка додає до `organization_currencies`
// колонку, чиє ІМʼЯ МІСТИТЬ `rate`, валить збірку.
//
// Саме «містить», а не «закінчується на»: перша редакція цієї правки брала
// `\b\w*rate\b`, тобто лише суфікс, і `rate_manual NUMERIC(18,8)` проходив
// повз неї (рецензія раунду 6, п. 3.5). Три названі написання — це не сімʼя,
// а три приклади; сімʼя — це слово `rate` де завгодно в імені. Перебір у цей
// бік дешевий: хибне спрацювання видно тому, хто пише міграцію, і воно
// коштує одного перейменування, а пропуск коштує другого джерела курсу.
const RATE_COLUMN = /\b\w*rate\w*\b\s+(NUMERIC|DECIMAL|REAL|DOUBLE|FLOAT|INTEGER)/i;
const MIGRATIONS_DIR = 'db/postgres/migrations';
const rateColumnInCurrencies: string[] = [];
for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
  const text = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  // Прибираємо коментарі: міграція має право ПОЯСНЮВАТИ, чому такої колонки
  // немає, і пояснення не мусить валити гейт (AGENTS §4).
  const code = text.replace(/^\s*--.*$/gm, '');
  // Область — сама таблиця: `ALTER TABLE organization_currencies …` до
  // наступного `;`, і `CREATE TABLE organization_currencies (…)`.
  for (const m of code.matchAll(/(?:ALTER|CREATE)\s+TABLE[^;]*?organization_currencies[\s\S]*?;/gi)) {
    if (RATE_COLUMN.test(m[0])) rateColumnInCurrencies.push(file);
  }
}
assert.deepStrictEqual(rateColumnInCurrencies, [],
  'в organization_currencies зʼявилась колонка, чиє імʼя містить rate — '
  + 'курс живе в finance_exchange_rates, і лише там (ARCHITECTURE §2.2.1, О7). '
  + `Знайдено в: ${rateColumnInCurrencies.join(', ')}`);
// Те саме про дзеркало SQLite: колонка, дописана лише туди, обійшла б перевірку
// міграцій і зʼявилась би в кожного розробника й у CI.
//
// Тіло `CREATE TABLE` береться з балансуванням дужок, а не лінивим `…?\)`:
// перший же `)` у цій таблиці закриває `DEFAULT (lower(hex(randomblob(16))))`,
// тож ліниве збігання читало б два рядки замість усієї таблиці й мовчало б на
// колонці, дописаній нижче. `ALTER TABLE … ADD COLUMN` — окремо, бо в
// SQLite-дзеркалі колонки часто додаються саме так (AGENTS §4).
const schemaTs = fs.readFileSync('src/lib/db.ts', 'utf8');

function tableBody(text: string, table: string): string[] {
  const bodies: string[] = [];
  const head = new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table}\\s*\\(`, 'gi');
  for (const m of text.matchAll(head)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const from = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    bodies.push(text.slice(from, i));
  }
  return bodies;
}

for (const body of tableBody(schemaTs, 'organization_currencies')) {
  assert.ok(!RATE_COLUMN.test(body),
    'у дзеркалі SQLite organization_currencies дістала колонку курсу — те саме друге джерело істини');
}
for (const m of schemaTs.matchAll(/ALTER\s+TABLE\s+organization_currencies\s+ADD\s+COLUMN[^'"`;]*/gi)) {
  assert.ok(!RATE_COLUMN.test(m[0]),
    `курс дописано в organization_currencies через ALTER: ${m[0].trim()}`);
}
assert.ok(/INSERT INTO finance_exchange_rates/.test(currency),
  'ручний курс пишеться не у finance_exchange_rates — тобто в друге джерело істини');
// Запис валют живе в core, а не в модулі. Храповик меж спіймав протилежне:
// поки таблицю писав @properties, вона ставала його власністю, і читання з
// core рахувалось пробоєм — що правильно як діагноз, бо валюта наскрізна.
assert.ok(!/INSERT INTO organization_currencies/.test(handlers),
  'хендлер знову пише organization_currencies напряму — таблиця стає власністю @properties, а валюта наскрізна');
console.log('  ok  курс має одне джерело — finance_exchange_rates');

// ── Другорядних не більше трьох ─────────────────────────────────────────
assert.ok(/MAX_SECONDARY_CURRENCIES = 3/.test(currency),
  'межа другорядних валют змінилась — це продуктове рішення, не константа');
assert.ok(/incoming\.length > MAX_SECONDARY_CURRENCIES/.test(handlers),
  'сервер не перевіряє межу — екран можна обійти запитом');
console.log('  ok  межа в три валюти тримається на сервері');

console.log('  ok  валюта: своя в кожного готеля, без крон за замовчуванням');
