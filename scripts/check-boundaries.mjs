/**
 * How isolated is each module, as a number rather than an opinion?
 *
 *   node scripts/check-boundaries.mjs
 *   node scripts/check-boundaries.mjs bookings   # what holds one module in place
 *
 * A module is isolated when deleting its directory breaks the build in exactly
 * zero places outside it. Until that is true, "we could pull this out later" is
 * a guess. This counts the places, names them, and separates the two kinds:
 *
 *   через фасад   an import from '@crm' — the module's front door. Fine by
 *                 design, and cheap to cut: it is one import line.
 *   ПРОБІЙ        an import that reaches past the front door into data/,
 *                 domain/ or events/, or a raw SQL query against a table the
 *                 module owns. This is what makes removal expensive, and it is
 *                 what the tsconfig aliases exist to prevent.
 *
 * A module has TWO front doors, not one. '@mod' carries server code and pulls
 * in better-sqlite3, so a 'use client' component can never import it; React
 * components therefore come from 'modules/mod/ui/…' directly, and that path
 * counts as the front door rather than a breach.
 *
 * Read the second number. The first is the size of the seam; the second is
 * whether there is a seam at all.
 *
 * --strict is a RATCHET, not a target. The BASELINE below is how many
 * breaches each module had the day the gate started blocking (2026-08-27) —
 * a ceiling, not a goal. One more breach fails the build and names the file;
 * one less fails too, asking to lower the ceiling, so progress locks in and
 * cannot silently slide back. Zero is unreachable today and that is fine;
 * what must stay unreachable is growth. A module absent from the list has a
 * ceiling of zero: a new module is born isolated.
 *
 * The numbers in ARCHITECTURE §8 drifted within two weeks of being written —
 * dashboard and channels each grew a breach, guests grew two, and nothing
 * said so. That drift is why this is a gate now and not a report.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASELINE = {
  auth: 0,
  // 3 → 2 (07.09.2026, К4). ЦЕ НЕ ПРОГРЕС, і читати його так не можна.
  // `reservation_sub_bookings` перестала бути власністю `bookings`, бо в неї
  // тепер пише ще й модуль каналів: група з каналу описується рідними рядками
  // групи (К4), а дверей у фасаді `@bookings` для цього немає — задача Блоку 3
  // §1 прямо каже зробити мінімальну функцію у своєму файлі й назвати брак
  // дверей у звіті. Таблиця стала спільною — отже два SQL-звертання ззовні
  // (`scripts/check-isolation.mjs` і перевірка каналів) більше не пробої за
  // означенням гейта. Стеля опущена, щоб храповик лишався живим; справжня
  // робота — двері `@bookings` для групи, і вона за сесією, яка переробляє
  // картку броні. Клас INC-018: число покращилось від зміни, яка нічого не
  // ізолювала.
  bookings: 2,
  channels: 1,
  dashboard: 1,
  events: 1,
  // 15 → 4: фактурування виїхало в @invoicing, і разом із ним 11 місць, де
  // маршрути документів лізли в нутрощі обліку. Те, що лишилось, — облік і є.
  // 4 → 13 (05.09.2026, INC-018): не ріст, а зір. Міграції в src/lib/db.ts
  // пишуть у fin_operations і expense_categories, і гейт рахував схему
  // співвласником — таблиці «спільні», і маршрути платежів, фактур і
  // звітів із власним SQL до fin_operations ніколи не були пробоями.
  // Тепер схема не власник і не співвласник; ці 13 були тут увесь час.
  // 11 → 10 (07.09.2026, Р8.7): `app/api/payments/[id]` більше не видаляє
  // `fin_operations` власним SQL — воно кличе `deletePaymentOperation`.
  // Пробій пішов разом із витоком грошей, а не окремим прибиранням.
  finance: 10,
  // Стартова стеля нового модуля. Обидва пробої — SQL до таблиць
  // фактурування ззовні: PDF-маршрут читає fin_folios сам, а аркуші дня
  // рахують ПДВ прямо з fin_invoice_tax_totals. Обидва старші за розділення
  // й обидва лікуються запитом до фасаду, а не переїздом файлу.
  // 2 → 3 (05.09.2026, INC-018): та сама сліпота — бекфіл у db.ts пише в
  // invoice_periods, і lock-period/route.ts зі своїм SQL до неї не рахувався.
  // 3 → 4 → 3 за добу (10.09.2026, задачі 12 і 13), і ЧИТАТИ ЦЕ ЯК ПРОГРЕС
  // НЕ МОЖНА — це клас INC-018.
  //
  // Зростання: `scripts/count-payer-folios.mjs` читав `fin_folios` власним
  // SQL. Фасад `@invoicing` там не двері за побудовою — скрипт питає про
  // БАЗУ, а не про орендаря (одним числом по всіх організаціях), а кожен
  // читач модуля починається з `requireOrganizationId()` і живе під
  // політиками.
  //
  // Повернення до 3: той самий інструмент переїхав у
  // `deploy/count-payer-folios.sh` — не заради гейта, а тому що зʼєднанням
  // застосунку він падав на політиці `fin_folios` (`unrecognized
  // configuration parameter`), і правильна форма для такого питання —
  // суперкористувач із `SET row_security = off`, тобто взірець
  // `deploy/check-overlaps.sh`. Число впало НЕ тому, що межу полагодили, а
  // тому, що гейт читає `.ts/.tsx/.mjs` і не читає `.sh`: той самий SQL до
  // `fin_folios` нікуди не подівся. Стеля опущена, щоб храповик лишався
  // живим, але ця стрічка стоїть тут, щоб наступний не порахував це
  // ізоляцією.
  invoicing: 3,
  // 8 → 7: обидва GDPR-крони тепер кличуть anonymizeOldRegistrations через
  // фасад @guests, а не з data/ напряму (INC-009 — заодно два маршрути
  // перестали тримати дві копії однієї ретенційної логіки).
  // 7 → 5 (05.09.2026, INC-018): два «пробої» були коментарями —
  // `// … guest screens` і `/* ── update guest ── */`. Пробій — це код.
  guests: 5,
  // 6 → 5 (05.09.2026, INC-018): один із шести — рядок доку в
  // check-price-source.mjs, який пояснює, що він ловить.
  pricing: 5,
  // 9 → 7: групові броні видалено, і разом із ними два екрани, які лізли в
  // modules/properties повз фасад (GroupBookingModal, GroupViewModal).
  // 5 → 4 (05.09.2026, INC-018): «SQL до property» у translate.ts — це
  // «strings from property/unit-type config» у doc-коментарі.
  properties: 4,
  reports: 0,
  tasks: 1,
  widget: 6,
};

/**
 * ── Друга вісь: ЗВОРОТНИЙ напрямок ──────────────────────────────────────
 *
 * Перша вісь рахує глибину: наскільки далеко чужий код лізе всередину
 * модуля. Вона мовчить про НАПРЯМОК, і саме тому пропустила Р13.15:
 * `properties/data/properties.repo.ts` імпортував перелік типів житла з
 * `modules/channels/ui/` — через парадну, тобто «нормально» за першою
 * віссю. А наслідок був не нормальний: писач обʼєкта в базовому модулі
 * відмовляв за списком ВЕНДОРА КАНАЛІВ навіть готелю, який модуль каналів
 * не купував.
 *
 * Правило: модуль, за який беруть окремі гроші, вимикається без шкоди
 * решті. Отже базова частина системи не має від нього залежати — ні через
 * нутрощі, ні через парадну. Тут парадна не виправдання: рахується сама
 * залежність.
 *
 * ПРОДАВАНІ — модулі, чий ключ у `FEATURE_SPEC` стоїть `OFF` і покриває
 * директорію цілком (`src/core/features.ts`). `invoicing` і `dashboard`
 * сюди не входять: вони `ON`, тобто є в кожного готелю.
 */
const SELLABLE = {
  channels: 'channels',      // FEATURE_SPEC.channels — OFF, платно
  finance: 'accounting',     // FEATURE_SPEC.accounting — OFF
  events: 'events',          // FEATURE_SPEC.events — OFF
  reports: 'reports',        // FEATURE_SPEC.reports — OFF
  tasks: 'tasks',            // FEATURE_SPEC.tasks — OFF
  'day-sheets': 'day_sheets', // FEATURE_SPEC.day_sheets — OFF
};

/**
 * Скільки місць базової частини залежать від продаваного модуля — СТЕЛЯ.
 *
 * Той самий храповик, що й вище: більше — збірка падає, менше — вимагає
 * опустити стелю. Пари, якої тут немає, стеля нуль: нова залежність
 * базового модуля від продаваного не заводиться мовчки.
 *
 * Знято 2026-09-09, і числа тут — не мета, а те, що було в день, коли ця
 * вісь почала блокувати. `properties→channels` було 4 і стало 3: четвертим
 * був перелік типів житла, який поїхав у ядро (`@core/lodging-kinds`,
 * Р13.15). Три, що лишились, — виклики черги (`@channels/outbox`,
 * `@channels`): обʼєкт і фонд мусять сказати каналам, що наявність
 * змінилась. Вони справжні, і прибирати їх треба інакше — подією ядра, а
 * не переїздом файла. Це окрема робота.
 *
 * Два записи тут — не «дозволено», а «вже було, і не мною»:
 *   core→finance      `core/security/route-guard.ts:66` тягне
 *                     `@/modules/finance/api/_guard` лінивим `import()`.
 *                     Ядро питає дозволу в продаваного модуля — найгірший
 *                     напрямок із можливих, і найдорожчий у виправленні.
 *   pricing→channels  девʼять місць: кожен писач цін штовхає `noteRatesChanged`.
 */
const REVERSE_BASELINE = {
  'bookings→channels': 2,
  'core→finance': 1,
  'dashboard→channels': 1,
  'invoicing→finance': 1,
  'pricing→channels': 9,
  'properties→channels': 3,
  'widget→channels': 1,
};

const MODULES = fs.readdirSync('src/modules', { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name);

const args = process.argv.slice(2);
const strict = args.includes('--strict');
// In strict mode every module is compared against its ceiling; a single-module
// run would make the absent ones look like stale baseline entries.
const only = strict ? undefined : args.find((a) => !a.startsWith('--'));

const FILES = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx|mjs)$/.test(e.name)) continue;
    FILES.push([p.replace(/\\/g, '/').replace(/^\.\//, ''), fs.readFileSync(p, 'utf8')]);
  }
})('.');

/**
 * A module owns a table when it is the ONLY module that writes to it.
 *
 * Merely writing to it is not ownership: finance updates
 * reservations.payment_status, which would make reservations finance's property
 * and turn every screen showing a booking into a boundary breach. A shared
 * table is shared vocabulary, and reading one is not reaching into a module.
 */
/**
 * Prose is not SQL: `// Update tentative → confirmed` named a table for a while,
 * and `invoicing.check.ts` lists the ledger tables in its own doc comment.
 *
 * Line-based on purpose. The regex version (`/\/\*[\s\S]*?\*\//`) opened a
 * "comment" at the string `'/*'` in seed-demo-stays.mjs and swallowed sixty
 * lines of code — among them the script's real imports of modules/pricing/data
 * and modules/guests/data, which then counted as nothing. Only a line that
 * STARTS with `//` or `/*` is prose here; a trailing comment after code stays,
 * and if it names a table it is reported — a false breach is read once, a
 * swallowed one is never seen.
 */
const stripComments = (s) => {
  const out = [];
  let inBlock = false;
  for (const line of s.split('\n')) {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlock = false;
      out.push(line.slice(end + 2));
      continue;
    }
    const t = line.trimStart();
    if (t.startsWith('//')) continue;
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/', 2);
      if (end === -1) { inBlock = true; continue; }
      out.push(t.slice(end + 2));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

const WRITERS = new Map(); // table -> Set<module>, or the marker 'ЗЗОВНІ'
for (const [f, text] of FILES) {
  // The schema file backfills and seeds by definition (migration 0062 wrote
  // `UPDATE price_calendar SET base_price = NULL`), and that is not a second
  // writer: counting it made price_calendar "shared", and three real breaches
  // — a route, a widget handler, a script — vanished from the report as
  // progress, asking to LOWER the ceiling. A gate that goes green from a
  // migration is a gate that no longer goes red (AGENTS invariant 24).
  if (f === 'src/lib/db.ts') continue;
  const m = f.match(/^src\/modules\/([^/]+)\//);
  // A write from a route file, a page or a script belongs to no module — and a
  // table written from there is not any module's private property, however it
  // looks from inside one.
  const owner = m ? m[1] : 'ЗЗОВНІ';
  for (const w of stripComments(text).matchAll(/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE)\s+["'`]?([a-z_0-9]+)/gi)) {
    const t = w[1].toLowerCase();
    // `UPDATE a SET …` is an alias inside a longer statement, not a table.
    if (t.length <= 2) continue;
    if (!WRITERS.has(t)) WRITERS.set(t, new Set());
    WRITERS.get(t).add(owner);
  }
}

function tablesOf(mod) {
  return new Set(
    [...WRITERS].filter(([, mods]) => mods.size === 1 && mods.has(mod)).map(([t]) => t),
  );
}

const report = [];

for (const mod of MODULES) {
  if (only && mod !== only) continue;

  const owned = tablesOf(mod);
  const viaFacade = [];
  const breaches = [];

  for (const [f, text] of FILES) {
    if (f.startsWith(`src/modules/${mod}/`)) continue;
    // The schema file names every table by definition; that is its job, not a
    // reach into anyone. It is the one place a table exists before a module.
    if (f === 'src/lib/db.ts') continue;

    // Front door: '@mod' for server code, 'modules/mod/ui/…' for React.
    const front = new RegExp(`['"](?:@${mod}(?:/[^'"]*)?|[^'"]*modules/${mod}/ui/[^'"]*)['"]`);
    const body = stripComments(text);
    if (front.test(text)) viaFacade.push(f);

    // Past the front door. `import(…)` counts as much as `from …` — a
    // dynamic() import of a module's internals is the same reach, just later.
    const deep = new RegExp(`(?:from|import\\()\\s*['"][^'"]*modules/${mod}/(data|domain|events)/`);
    if (deep.test(body)) breaches.push(`${f} — імпорт нутрощів`);

    // Someone else's SQL against a table this module owns.
    for (const t of owned) {
      const sql = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+["'\`]?${t}\\b`, 'i');
      if (sql.test(body)) { breaches.push(`${f} — SQL до ${t}`); break; }
    }
  }

  report.push({ mod, facade: viaFacade.length, breaches, files: viaFacade });
}

report.sort((a, b) => (a.breaches.length - b.breaches.length) || (a.facade - b.facade));

/**
 * Зворотний напрямок: базова частина → продаваний модуль.
 *
 * Базова частина — це `src/core/**` і кожен модуль, якого немає в SELLABLE.
 * Залежність продаваного від продаваного не рахується: обидва вимикаються
 * разом, і канал, який читає облік, нікому не ламає готель без обох.
 */
const reverse = new Map(); // 'база→продаване' -> [файли]
for (const [f, text] of FILES) {
  const m = f.match(/^src\/(core|modules\/([^/]+))\//);
  if (!m) continue;
  const from = m[2] ?? 'core';
  if (SELLABLE[from]) continue;
  const body = stripComments(text);
  for (const mod of Object.keys(SELLABLE)) {
    if (from === mod) continue;
    // І парадна, і нутрощі — тут це одна й та сама залежність.
    const dep = new RegExp(`(?:from|import\\()\\s*['"](?:@${mod}(?:/[^'"]*)?|[^'"]*modules/${mod}/[^'"]*)['"]`);
    if (!dep.test(body)) continue;
    const key = `${from}→${mod}`;
    if (!reverse.has(key)) reverse.set(key, []);
    reverse.get(key).push(f);
  }
}

console.log();
console.log('ЗВОРОТНИЙ НАПРЯМОК — базова частина залежить від продаваного');
if (reverse.size === 0) {
  console.log('  (жодного місця)');
} else {
  for (const key of [...reverse.keys()].sort()) {
    const ceiling = REVERSE_BASELINE[key] ?? 0;
    console.log(`  ${key.padEnd(26)}${String(reverse.get(key).length).padStart(4)}   стеля ${ceiling}`);
  }
}

console.log('═'.repeat(78));
console.log('МЕЖІ МОДУЛІВ — скільки місць поза модулем зламається при видаленні');
console.log('═'.repeat(78));
console.log();
console.log('  модуль          через фасад   пробоїв');
for (const r of report) {
  const flag = r.breaches.length === 0 ? (r.facade === 0 ? '  ізольований' : '') : '  ← тримає';
  console.log(`  ${r.mod.padEnd(16)}${String(r.facade).padStart(6)}${String(r.breaches.length).padStart(10)}${flag}`);
}
console.log();

if (only) {
  const r = report[0];
  if (r.files.length) {
    console.log(`Через фасад '@${only}' (${r.files.length}):`);
    for (const f of r.files) console.log(`  ${f}`);
    console.log();
  }
  if (r.breaches.length) {
    console.log(`Пробої (${r.breaches.length}):`);
    for (const b of r.breaches) console.log(`  ${b}`);
  }
} else {
  console.log('Деталі по одному модулю:  node scripts/check-boundaries.mjs <модуль>');
}

if (strict) {
  const problems = [];

  for (const r of report) {
    const ceiling = BASELINE[r.mod] ?? 0;
    const now = r.breaches.length;
    if (now > ceiling) {
      problems.push(
        `  ${r.mod}: пробоїв ${now}, стеля ${ceiling} — НОВИЙ ПРОБІЙ. Модуль відкривають лише його фасади` +
        ` ('@${r.mod}' і modules/${r.mod}/ui/); знайдіть свій серед:`,
      );
      for (const b of r.breaches) problems.push(`      ${b}`);
    } else if (now < ceiling) {
      problems.push(
        `  ${r.mod}: пробоїв ${now}, стеля ${ceiling} — стало КРАЩЕ. Опустіть стелю: у BASELINE` +
        ` (scripts/check-boundaries.mjs) поставте ${r.mod}: ${now}, щоб прогрес не відкотився мовчки.`,
      );
    }
  }

  for (const mod of Object.keys(BASELINE)) {
    if (!MODULES.includes(mod)) {
      problems.push(`  ${mod}: є в BASELINE, але src/modules/${mod} не існує — приберіть застарілий запис.`);
    }
  }

  // Друга вісь, тим самим храповиком.
  for (const key of new Set([...reverse.keys(), ...Object.keys(REVERSE_BASELINE)])) {
    const now = reverse.get(key)?.length ?? 0;
    const ceiling = REVERSE_BASELINE[key] ?? 0;
    if (now > ceiling) {
      problems.push(
        `  ${key}: залежностей ${now}, стеля ${ceiling} — БАЗОВА ЧАСТИНА ПОЛІЗЛА В ПРОДАВАНЕ.` +
        ' Модуль, за який беруть гроші, вимикається без шкоди решті; те, що потрібне обом,' +
        ' живе в ядрі (як `@core/lodging-kinds`). Місця:',
      );
      for (const f of reverse.get(key) ?? []) problems.push(`      ${f}`);
    } else if (now < ceiling) {
      problems.push(
        `  ${key}: залежностей ${now}, стеля ${ceiling} — стало КРАЩЕ. Опустіть стелю: у` +
        ` REVERSE_BASELINE (scripts/check-boundaries.mjs) поставте '${key}': ${now}.`,
      );
    }
  }

  console.log();
  if (problems.length) {
    console.log('ХРАПОВИК МЕЖ — збірка зупинена:');
    for (const p of problems) console.log(p);
    console.log();
    console.log('  Пробій — це імпорт modules/<x>/(data|domain|events) ззовні або SQL до таблиці,');
    console.log('  якою володіє лише той модуль. Правильні двері — фасад @<x> або modules/<x>/ui/.');
    process.exit(1);
  }
  const total = report.reduce((n, r) => n + r.breaches.length, 0);
  console.log(`  храповик меж: пробої не зросли (${total} по ${report.length} модулях, у межах стелі)`);
}
