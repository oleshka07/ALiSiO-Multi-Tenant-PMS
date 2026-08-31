/**
 * Бронь без призначеного номера не сміє мовчки зникати зі списків.
 *
 *   node scripts/check-unit-join.mjs [--strict]
 *
 * ── Навіщо ────────────────────────────────────────────────────────────────
 *
 * CP3 інтеграції з каналами: бронь має вміти існувати з `unit_type_id` і
 * БЕЗ `unit_id`. Channex про `units` не знає нічого — він адресує тип номера
 * й тариф, тож OTA-бронь приходить без конкретної кімнати, і рецепція
 * призначає її потім.
 *
 * Небезпека тут не в самій колонці, а в тому, ЯК це ламається.
 *
 *     FROM reservations r
 *     JOIN units u ON r.unit_id = u.id      ← INNER
 *
 * INNER JOIN не падає — він **фільтрує**. Рядок із `unit_id IS NULL` просто
 * не потрапляє у вибірку. Тобто бронь зникає зі списку броней, зі списку
 * фактур, зі звіту з турзбору, з панелі й з API резервацій — без помилки,
 * без логу, без жодного сліду. Готель відкриває екран і не бачить броні, за
 * яку вже відповідає.
 *
 * Саме тому читачі переводяться на `LEFT JOIN` **до** того, як колонка стане
 * nullable, а не після: між двома деплоями система виглядала б робочою і
 * тихо ховала гроші.
 *
 * ── Що ловить ─────────────────────────────────────────────────────────────
 *
 * `JOIN units <alias> ON r.unit_id = <alias>.id` без `LEFT` — і так само
 * ланцюжок за ним: `JOIN categories c ON u.category_id = c.id`,
 * `JOIN unit_types ut ON u.unit_type_id = ut.id`. Другий INNER у ланцюжку
 * фільтрує рівно так само, як перший, тож LEFT лише на першому — це
 * половина виправлення, яка має вигляд цілого.
 *
 * Не ловить джойни від інших таблиць (`ab.unit_id`, `u.id = ut.…`) — там
 * колонка не nullable і питання не стоїть.
 *
 * ── ВИНЯТКИ, і чому їх не «полагодили» ────────────────────────────────────
 *
 * Два місця рахують НАЯВНІСТЬ: які номери зайняті на ці дати. Там `LEFT
 * JOIN` не допомагає й був би шкідливий — він дав би хибний спокій. Бронь
 * без `unit_id` не займає КОНКРЕТНОГО номера; вона займає один номер
 * ЦЬОГО ТИПУ, і порахувати це можна лише на рівні типу. Тобто це не правка
 * джойна, а зміна моделі наявності, і вона йде разом зі зняттям NOT NULL
 * (CP2 + CP3, PLAN-CORE-REBUILD §7.2).
 *
 * Виняток, який перестав бути потрібним, валить `--strict`: список лише
 * коротшає, як і в решти храповиків цього проєкту.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Місця, де INNER лишається свідомо. Ключ — файл, значення — причина. */
const ALLOWED = new Map([
  ['src/modules/widget/api/widget-calendar-public.handlers.ts',
    'рахує зайняті номери для публічного календаря — модель наявності, не джойн (CP2+CP3)'],
  ['src/modules/widget/api/widget-config-public.handlers.ts',
    'той самий розрахунок для пошуку у віджеті — той самий висновок'],
]);

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'harvest']);

/** Коментарі вирізаються: інакше перевірка рахує власну документацію. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
    .replace(/^\s*--[^\n]*/gm, (m) => ' '.repeat(m.length));
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue; }
    if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.check.ts')) files.push(path.join(dir, e.name));
  }
})(path.join(ROOT, 'src'));

// `LEFT` захоплюється, а не відсікається лукбігайндом.
//
// Спершу тут стояв `(?<!LEFT\s)`, і гейт мав діру рівно того класу, який він
// існує ловити: коли ПЕРШИЙ джойн уже `LEFT`, регулярка не спрацьовувала,
// alias не встановлювався — і INNER у ЛАНЦЮЖКУ за ним не перевірявся ніколи.
// Тобто половина виправлення проходила як ціле. Знайдено спробою завалити
// власний гейт, а не читанням.
const RESERVATION_UNIT = /\b(LEFT\s+)?JOIN\s+units\s+(\w+)\s+ON\s+r\.unit_id\s*=\s*\2\.id/i;
const CHAIN = /\b(LEFT\s+)?JOIN\s+(categories|unit_types)\s+(\w+)\s+ON\s+(\w+)\.(category_id|unit_type_id)\s*=\s*\3\.id/i;

const offenders = [];
const hit = new Set();

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const lines = stripComments(fs.readFileSync(abs, 'utf8')).split('\n');
  let alias = null;
  lines.forEach((line, i) => {
    const m = RESERVATION_UNIT.exec(line);
    if (m) {
      // Alias запам'ятовується В БУДЬ-ЯКОМУ разі — саме тому, що ланцюжок за
      // вже виправленим `LEFT JOIN units` теж треба перевірити.
      alias = m[2];
      if (!m[1]) {
        hit.add(rel);
        if (!ALLOWED.has(rel)) offenders.push({ rel, line: i + 1, what: 'JOIN units на r.unit_id' });
      }
      return;
    }
    if (!alias) return;
    const c = CHAIN.exec(line);
    if (c && c[4] === alias) {
      if (!c[1]) {
        hit.add(rel);
        if (!ALLOWED.has(rel)) offenders.push({ rel, line: i + 1, what: `JOIN ${c[2]} у ланцюжку від ${alias}` });
      }
      return;
    }
    // Межа запиту: далі alias більше не діє.
    if (line.includes('`') || /^\s*(WHERE|ORDER|GROUP|HAVING|SELECT|FROM)\b/i.test(line)) alias = null;
  });
}

const stale = [...ALLOWED.keys()].filter((f) => !hit.has(f));

let failed = false;

if (offenders.length) {
  failed = true;
  console.error('\n✗ INNER JOIN на reservations.unit_id — бронь без номера тут ЗНИКНЕ:\n');
  for (const o of offenders) console.error(`  ${o.rel}:${o.line}  ${o.what}`);
  console.error('\n  Замініть на LEFT JOIN — разом із ланцюжком (categories, unit_types),');
  console.error('  бо другий INNER фільтрує так само, як перший. Поля номера тоді');
  console.error('  можуть прийти NULL: покажіть «номер не призначено», а не порожньо.');
}

if (stale.length) {
  failed = true;
  for (const f of stale) {
    console.error(`\n✗ виняток більше не потрібен: ${f}`);
    console.error('  Файл більше не має INNER JOIN на r.unit_id — приберіть його з ALLOWED');
    console.error('  у scripts/check-unit-join.mjs. Список лише коротшає.');
  }
}

if (!failed) {
  console.log('unit-join');
  console.log(`  чисто — жодного INNER JOIN на reservations.unit_id, крім ${ALLOWED.size} свідомих:`);
  for (const [f, why] of ALLOWED) console.log(`    ${f}\n      ${why}`);
}

if (failed && strict) process.exit(1);
if (failed) console.error('\n(режим звіту — --strict завалив би збірку)');
