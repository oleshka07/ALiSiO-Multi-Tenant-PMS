/**
 * The price of a night is asked in one place, or the numbers stop matching.
 *
 *   node scripts/check-price-source.mjs [--strict]
 *
 * AGENTS.md §3 invariant 16: only `priceNights()` (modules/pricing) may answer
 * what a night costs. There used to be four hand-rolled day loops, each with
 * its own copy of the weekend rule and one with `let dayPrice = 2500` — one
 * customer's number, quietly billed to whoever booked next. The loops were
 * folded into `nightly-price.ts`, but nothing has been keeping new ones out —
 * and the survivors below are exactly why the same stay shows different
 * numbers on different screens today.
 *
 * What this checks: any SQL that touches the price tables
 * (`price_calendar`, `price_occupancy`, `price_los_tiers`) from outside
 * `src/modules/pricing/`. A file that queries them directly is one weekend
 * rule away from drifting — the query itself is the violation, whatever it
 * computes afterwards.
 *
 * Deliberately narrow: variable names (`hasPriceCalendar`), i18n keys and UI
 * copy do not trip it — only FROM/JOIN/INTO/UPDATE against a price table.
 *
 * The LEGACY list is the debt that existed when the gate was written. Each
 * entry says what diverges and what the fix is. New entries are not added —
 * new code goes through `@pricing`. An entry whose file no longer queries the
 * tables is stale and fails --strict, so the list can only shrink.
 *
 * ── Друге правило: точка збуту не називає власної ціни (Ц7) ────────────────
 *
 * `rate_plans.fixed_price` існувала з першого дня і не мала ЖОДНОГО читача й
 * жодного писача за всю історію `src/` — але три гілки у віджеті питали
 * `fixed_price` в обʼєкта із `site_rate_plans`, де такої колонки немає. Мертвий
 * код над мертвою колонкою: гість бачив базову ціну там, де мав побачити
 * фіксовану, і жодного сліду в логах.
 *
 * Рішення Ц7 зробило це не недоглядом, а забороною: ціну ночі називає лише
 * `priceNights()`, точка збуту її ЗСУВАЄ. Колонка, у якій тариф може написати
 * власне число, — це заряджена рушниця, і `audit-dead-data.mjs` її не бачить
 * за означенням: слово `fixed_price` живе в коді як значення `discount_type`
 * у знижках, тож колонка виглядає використаною.
 *
 * Звідси форма правила: `fixed_price` дозволене ЛИШЕ в лапках (рядкове
 * значення знижки). Голий ідентифікатор — `fixed_price REAL`, `r.fixed_price`,
 * `SELECT fixed_price` — це колонка, і це відмова. Правило ловить нового читача
 * САМОЇ КОЛОНКИ, а не лише повернення поля в хелпер `ratePlanNightPrice()`:
 * перевернутий контракт у `rate-plan.check.ts` тримає другу половину.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const strict = process.argv.includes('--strict');
// fileURLToPath, не URL.pathname: на Windows pathname лишає %20 і слеш перед
// літерою диска, і readdir шукав 'D:\D:\…' — гейт падав, не перевіривши нічого.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

// SQL that reads or writes a price table. INSERT INTO / DELETE FROM are
// covered by INTO / FROM; UPDATE stands on its own.
const QUERY = /\b(?:FROM|JOIN|INTO|UPDATE)\s+["'`]?price_(?:calendar|occupancy|los_tiers)\b/i;

// Голий `fixed_price` — тобто колонка, а не значення `discount_type` у лапках.
// Лапка будь-якого з трьох видів безпосередньо перед словом або після нього
// знімає підозру; усе інше — ідентифікатор.
const OWN_PRICE = /(?<!['"`])\bfixed_price\b(?!['"`])/;

/**
 * Коментарі геть — інакше перевірка рахує власну документацію.
 *
 * AGENTS §4: тричі за одну сесію гейт ловив свій же приклад того, що вже
 * виправлено. Пояснення, ЧОМУ колонки більше немає, живуть у коментарях —
 * і мають там жити, не валячи збірку.
 *
 * Переводи рядків при цьому ЗБЕРІГАЮТЬСЯ. Перша версія стискала блоковий
 * коментар у пробіл, і гейт показав `db.ts:388` замість 228 — на 160 рядків
 * повз. Повідомлення, яке вказує не туди, гірше за відсутнє: за ним ідуть
 * дивитись і не знаходять.
 *
 * І це СКАНЕР, а не пара `replace`. Двома регулярками не виходить: у db.ts
 * рядковий коментар містить `scripts/*.mjs`, і `/*` усередині нього відкрив
 * блок на 780 рядків — разом із `fixed_price REAL` на 228-му. Гейт після цього
 * доповідав про геть інше місце, і був би зеленим, якби порушення лишилось
 * тільки там. Зворотний порядок (спершу рядкові) ламається дзеркально: подвійна
 * скісна риска всередині блокового коментаря зʼїдає його термінатор, якщо той
 * стоїть наприкінці того ж рядка.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  // Стани: код, рядковий коментар, блоковий, три види лапок. Із рядка виходимо
  // по тій самій лапці, з якої зайшли; `\` пропускає наступний символ.
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') { out += text[i]; i++; if (i < n) { out += text[i]; i++; } continue; }
        out += text[i]; i++;
      }
      if (i < n) { out += text[i]; i++; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

// The debt as of 2026-08-24 — see docs/AUDIT.md §2 for the full stories.
//
// The list had a third entry: the ARI push to Booking.com, which priced nights
// from price_calendar with its own weekend rule. It was not fixed, it was
// deleted along with the rest of the Connectivity API (audit A2 → migration
// 0032), which is the other way a legacy entry may leave this list.
const LEGACY = new Map([
  ['src/app/api/booking-sites/[id]/listings/route.ts',
    'the admin "from" price is MIN(base_price) over price_calendar; the ' +
    'public month calendar answers from the matrix via cheapestByDay(), so ' +
    'the two screens disagree for any hotel that filled the matrix. ' +
    'Fix: ask cheapestByDay() here too.'],
  ['src/modules/widget/api/widget-calendar-public.handlers.ts',
    'merges the matrix with its own MIN() over price_calendar and re-decides ' +
    'weekend locally — a third copy of the weekend rule. ' +
    'Fix: extend cheapestByDay() to fall back to the day calendar and delete ' +
    'the local query.'],
]);

const offenders = [];   // new violations
const ownPrice = [];    // «тариф називає власну ціну» — Ц7
const covered = new Set(); // legacy entries that still match

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

    // Друге правило — БЕЗ винятків за текою: колонка народжується саме в
    // `src/lib/db.ts`, і модуль цін має підкорятись йому найперше.
    {
      const bare = stripComments(fs.readFileSync(p, 'utf8'));
      const at = bare.search(OWN_PRICE);
      if (at >= 0) ownPrice.push({ rel, line: bare.slice(0, at).split('\n').length });
    }
    // The module that owns the tables, and the schema that creates them.
    if (rel.startsWith('src/modules/pricing/')) continue;
    if (rel === 'src/lib/db.ts') continue;

    const text = fs.readFileSync(p, 'utf8');
    if (!QUERY.test(text)) continue;

    if (LEGACY.has(rel)) { covered.add(rel); continue; }

    const line = text.slice(0, text.search(QUERY)).split('\n').length;
    offenders.push({ rel, line });
  }
}

walk(SRC);

const stale = [...LEGACY.keys()].filter((f) => !covered.has(f) && fs.existsSync(path.join(ROOT, f)));
const gone = [...LEGACY.keys()].filter((f) => !fs.existsSync(path.join(ROOT, f)));

let failed = false;

if (offenders.length) {
  failed = true;
  console.error('\n✗ price tables queried outside modules/pricing — a second price source:\n');
  for (const o of offenders) {
    console.error(`  ${o.rel}:${o.line}`);
  }
  console.error('\n  Ask @pricing instead: priceNights() prices a stay, cheapestByDay()');
  console.error('  answers "from" figures. A direct query is how the four loops happened.');
}

if (ownPrice.length) {
  failed = true;
  console.error('\n✗ `fixed_price` голим ідентифікатором — точка збуту називає власну ціну (Ц7):\n');
  for (const o of ownPrice) console.error(`  ${o.rel}:${o.line}`);
  console.error('\n  Ціна ночі одна — `priceNights()`. Точка збуту лише ЗСУВАЄ її');
  console.error('  через `pricing_modifier_percent`; власного числа вона не називає.');
  console.error('  Значення знижки пишеться в лапках (\'fixed_price\'), колонка — ні.');
}

if (stale.length || gone.length) {
  for (const f of [...stale, ...gone]) {
    console.error(`\n✗ LEGACY entry no longer matches: ${f}`);
    console.error('  The file stopped querying price tables (or was removed) — delete its');
    console.error('  entry from LEGACY in scripts/check-price-source.mjs. The list only shrinks.');
  }
  failed = true;
}

if (!failed) {
  const n = covered.size;
  console.log(`✓ price source: no new readers outside modules/pricing (${n} known legacy, see docs/AUDIT.md §2)`);
  console.log('✓ own price: жоден тариф не називає власного числа — `fixed_price` лише як значення знижки (Ц7)');
}

if (failed && strict) process.exit(1);
if (failed) console.error('\n(report mode — --strict would fail the build)');
