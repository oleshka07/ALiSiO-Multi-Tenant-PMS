/**
 * «Чи вільно» питають в одному місці, інакше числа розходяться.
 *
 *   node scripts/check-availability-source.mjs [--strict]
 *
 * Інваріант И3 (docs/CHANNEX-INTEGRATION.md §7): відповідь «номер вільний»
 * дає лише `@properties` — `freeUnitsForRange()` і `availabilityByDay()`.
 * Свій join по `reservations` × `availability_blocks` не пишеться, рівно як
 * не пишеться свій цикл по днях для цін (інваріант 16 і
 * `check-price-source.mjs`).
 *
 * Чому це окремий гейт, а не порада. Розрахунок наявності — це чотири
 * дрібниці, кожну з яких легко відтворити трохи інакше: півінтервал
 * (`<` чи `<=` на ніч виїзду), які статуси звільняють номер, чи рахуються
 * `availability_blocks`, чи виключено службовий фонд. Копія, що розійшлася в
 * будь-якій із них, не падає й нічого не логує — вона просто дає інше число.
 * Поки споживач був один, різниці не було видно. З каналами вона стає
 * овербукінгом: OTA продає номер, якого немає, і платить за це готель.
 *
 * ЩО САМЕ ЛОВИТЬ (навмисно вузько, щоб не шуміти):
 *
 *   A. `availability_blocks` із перетином дат. Ця таблиця існує рівно для
 *      того, щоб робити номер недоступним, тож запит із перетином до неї —
 *      це і є розрахунок наявності. CRUD над самою таблицею перетину не
 *      робить і сюди не потрапляє.
 *   B. `reservations` із перетином дат ТА відсіванням `cancelled`/`no_show`.
 *      Це підпис рішення «зайнято чи ні»: звіт за період так не питає, бо
 *      йому байдуже, хто звільняє номер.
 *
 * Не ловить: звіти за період, аркуші дня (`status IN (…LIVE)`, інші межі),
 * CRUD блокувань, назви змінних і тексти UI.
 *
 * LEGACY — це борг станом на 2026-08-29, коли гейт з'явився: місця, які
 * рахують наявність самі. Кожен запис каже, що саме там і чим це лікується.
 * Нові записи не додаються — новий код питає `@properties`. Запис, який
 * більше не збігається, валить `--strict`: список лише коротшає.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const strict = process.argv.includes('--strict');
// fileURLToPath, не URL.pathname — на Windows pathname лишає слеш перед
// літерою диска, і readdir шукає 'D:\D:\…'.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/**
 * Коментарі вирізаються ПЕРЕД пошуком (AGENTS.md §4).
 *
 * Інакше гейт рахує власну документацію: шаблон нижче дослівно описаний у
 * заголовку цього файла і в docs/CHANNEX-INTEGRATION.md, а `availability.ts`
 * пояснює півінтервал прикладом SQL. Так уже ловилися на собі
 * `currency.check` і `invoicing.check`.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * A. Перетин дат по таблиці блокувань.
 *
 * Строгі `<` і `>`, а не `<=`/`>=`: саме півінтервал `[from, to)` означає
 * питання «чи вільно» (ніч виїзду вільна). Звіти за період беруть межі
 * включно — і не мають сюди потрапляти. Без `(?!=)` гейт ловив
 * CSV-експорт броней, який нічого не рахує.
 */
const BLOCK_OVERLAP = /\bdate_from\s*<(?!=)[\s\S]{0,120}?\bdate_to\s*>(?!=)/i;
const BLOCK_TABLE = /\b(?:FROM|JOIN)\s+["'`]?availability_blocks\b/i;

/** B. Перетин дат по бронях + відсів скасованих — підпис «зайнято чи ні». */
const STAY_OVERLAP = /\bcheck_in\s*<(?!=)[\s\S]{0,120}?\bcheck_out\s*>(?!=)/i;
const LIVE_ONLY = /status\s+NOT\s+IN\s*\(\s*'cancelled'\s*,\s*'no_show'\s*\)/i;

/**
 * Питає не «чи вільно», а щось інше тим самим SQL.
 *
 * Звіт міського збору рахує ночі перебування в межах місяця: перетин той
 * самий, скасовані так само не рахуються — але відповідь не про
 * доступність, і переписувати його через `@properties` не треба.
 */
const EXEMPT = new Map([
  ['src/modules/reports/api/city-tax.handlers.ts',
    'звіт міського збору: ночі перебування в межах періоду, не доступність'],
]);

// Борг станом на 2026-08-29.
const LEGACY = new Map([
  ['src/modules/widget/api/widget-reserve.handlers.ts',
    'повторна перевірка перед записом броні — два запити (бронь, блок) з ' +
    'власними межами. Це остання лінія проти подвійного продажу, тож ' +
    'розходження тут дорожче за інші. Лікується freeUnitsForRange([unitId], …).'],
  ['src/modules/widget/api/widget-calendar-public.handlers.ts',
    'місячний календар віджета будує зайнятість сам, трьома різними ' +
    'запитами залежно від того, чи заданий сайт. Лікується availabilityByDay() ' +
    'на місяць із подальшим згортанням у дні.'],
  ['src/modules/widget/api/widget-config-public.handlers.ts',
    'preview «найближчі вільні дати» перебирає 60 днів уперед і на кожен ' +
    'день робить два запити на тип номера. Лікується одним availabilityByDay() ' +
    'на всі 60 днів — заодно зникає 120 запитів на відповідь.'],
  ['src/modules/channels/api/ical-sync.handlers.ts',
    'вибір вільного номера для імпортованої з iCal броні. Лікується ' +
    'freeUnitsForRange(unitIds, …) — тут же зникає цикл із запитом на номер.'],
  ['src/modules/bookings/api/reservations.handlers.ts',
    'вартовий подвійного бронювання при створенні броні оператором.'],
  ['src/modules/bookings/api/reservation.handlers.ts',
    'той самий вартовий при зміні броні (з виключенням самої броні за id).'],
  ['src/modules/bookings/api/sub-bookings.handlers.ts',
    'той самий вартовий для під-броней групового заїзду.'],
]);

const offenders = [];
const covered = new Set();

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p);
      continue;
    }
    if (!/\.(ts|tsx|mts)$/.test(e.name)) continue;

    const rel = path.relative(ROOT, p).replaceAll(path.sep, '/');
    // Модуль, який володіє відповіддю, і схема, яка створює таблиці.
    if (rel.startsWith('src/modules/properties/')) continue;
    if (rel === 'src/lib/db.ts') continue;
    if (EXEMPT.has(rel)) continue;

    const text = stripComments(fs.readFileSync(p, 'utf8'));
    const blocks = BLOCK_TABLE.test(text) && BLOCK_OVERLAP.test(text);
    const stays = STAY_OVERLAP.test(text) && LIVE_ONLY.test(text);
    if (!blocks && !stays) continue;

    if (LEGACY.has(rel)) { covered.add(rel); continue; }

    const idx = text.search(blocks ? BLOCK_OVERLAP : STAY_OVERLAP);
    offenders.push({ rel, line: text.slice(0, idx).split('\n').length });
  }
}

walk(SRC);

const stale = [...LEGACY.keys()].filter((f) => !covered.has(f) && fs.existsSync(path.join(ROOT, f)));
const gone = [...LEGACY.keys()].filter((f) => !fs.existsSync(path.join(ROOT, f)));

let failed = false;

if (offenders.length) {
  failed = true;
  console.error('\n✗ наявність рахується поза modules/properties — другий розрахунок:\n');
  for (const o of offenders) console.error(`  ${o.rel}:${o.line}`);
  console.error('\n  Питайте @properties: freeUnitsForRange() каже, хто вільний на весь');
  console.error('  заїзд, availabilityByDay() — скільки вільно щодня. Своя копія');
  console.error('  розходиться мовчки, і різницю бачить гість у зайнятому номері.');
}

if (stale.length || gone.length) {
  for (const f of [...stale, ...gone]) {
    console.error(`\n✗ запис LEGACY більше не збігається: ${f}`);
    console.error('  Файл перестав рахувати наявність сам (або зник) — приберіть його');
    console.error('  запис із LEGACY у scripts/check-availability-source.mjs. Список лише коротшає.');
  }
  failed = true;
}

if (!failed) {
  console.log(`✓ availability source: нових розрахунків поза modules/properties немає (${covered.size} у борзі)`);
}

if (failed && strict) process.exit(1);
if (failed) console.error('\n(режим звіту — --strict завалив би збірку)');
