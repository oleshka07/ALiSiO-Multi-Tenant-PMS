/**
 * Фікстура твердження не вироджена по осі, про яку воно стверджує.
 *
 *   node scripts/check-fixture-axes.mjs [--strict]
 *
 * ── Один звір, пʼять разів ──────────────────────────────────────────────
 *
 * За одну добу 01.09.2026 пʼять окремих відкриттів, і кожне коштувало
 * окремого прогону:
 *
 *   * DBL/TRI з `max_adults = max_occupancy` — не розрізняли два правила
 *     місткості, і обрізання по не тій колонці було зеленим;
 *   * одна ніч — не розрізняла «за ніч» і «за перебування»;
 *   * нульовий модифікатор — не розрізняв «зсув застосовано» і «зсув забуто»;
 *   * один тип номера — не розрізняв «вісь пари є» і «осі пари немає»;
 *   * засів, що котирував трьох дорослих у номер на двох.
 *
 * Це не пʼять недоглядів, а один клас: твердження, чия фікстура вироджена
 * по осі, яку воно нібито перевіряє. Зелено і з віссю, і без неї. Правило —
 * інваріант 26 AGENTS: для кожної осі, про яку твердження щось стверджує,
 * фікстура мусить містити щонайменше ДВА значення, що на цій осі різняться,
 * а очікуване число — бути арифметично несумісним з альтернативним
 * прочитанням.
 *
 * ── Що з цього рахується механічно, а що — ні ────────────────────────────
 *
 * Друга половина (несумісність числа) читається очима. Перша — «скільки
 * різних значень осі у фікстурі» — рахується: реєстр нижче каже, який файл
 * про яку вісь стверджує, і гейт лічить різні літерали. Це не доводить, що
 * твердження правильне; це не дає фікстурі тихо виродитись назад — рівно
 * так, як храповик меж не доводить архітектуру, а не дає їй поповзти.
 *
 * Реєстр — це ЗАЯВА перевірки про себе: «я розрізняю по цій осі». Нова
 * перевірка з віссю додає свій рядок сюди; перевірка без рядка нічого не
 * заявляє, і гейт про неї мовчить. Мовчання гейта ≠ доведеність.
 *
 * Коментарі вирізаються перед підрахунком (AGENTS §4): інакше гейт лічив
 * би власні приклади й прозу.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Одна вісь одного файла.
 *
 *   distinct — регулярка з ОДНІЄЮ групою захоплення; гейт лічить різні
 *              значення групи, поріг `min` (типово 2);
 *   some     — серед захоплених має бути хоч одне, що проходить `test`
 *              (ненульовий модифікатор, більше однієї ночі, дитина > 0);
 *   pairs    — регулярка з ДВОМА групами; гейт вимагає хоч одну пару, у якій
 *              значення РІЗНЯТЬСЯ (max_adults ≠ max_occupancy);
 *   scope    — регулярка, що вирізає СЦЕНУ (за її заголовком-коментарем, тож
 *              береться з сирого тексту, до вирізання коментарів). Без неї
 *              вісь лічиться по всьому файлу — і саме так перший варіант
 *              цього гейта був вироджений по тій самій осі, яку стереже:
 *              `'ut'` з чужих сцен тримав «два різних» навіть після того, як
 *              у сцені про пару лишився один тип. Знайдено зламом, як і
 *              належить (інваріант 24).
 */
const AXES = [
  // Два правила місткості: без типу, де вони розходяться, обрізання по не
  // тій колонці зелене.
  {
    file: 'src/modules/pricing/data/property-rate-plans.check.ts',
    axis: 'max_adults ≠ max_occupancy хоч в одного типу',
    pairs: /max_adults, max_children, max_occupancy, base_occupancy\)\s*VALUES \([^)]*?,\s*(\d+),\s*\d+,\s*(\d+),/g,
  },
  // «За ніч» проти «за перебування»: з однією ніччю обидва прочитання дають
  // одне число.
  {
    file: 'src/modules/pricing/domain/occupancy-price.check.ts',
    axis: 'ночей у сцені про тривалість проживання («за ніч» ≠ «за перебування»)',
    scope: /\/\/ ─── Length of stay[\s\S]*?(?=\n\/\/ ─── Vierbett)/,
    distinct: /\bnights:\s*(\d+)/g, min: 2,
    some: { pattern: /\bnights:\s*(\d+)/g, test: (v) => Number(v) > 1, why: 'потрібна хоч одна ніч > 1' },
  },
  {
    file: 'src/modules/pricing/domain/occupancy-price.check.ts',
    axis: 'дітей у котируванні (Ц12: дитина — не малий дорослий)',
    some: { pattern: /\bchildren:\s*(\d+)/g, test: (v) => Number(v) > 0, why: 'потрібне хоч одне котирування з дітьми' },
  },
  {
    file: 'src/modules/pricing/domain/occupancy-price.check.ts',
    axis: 'дорослих у котируванні',
    distinct: /\badults:\s*(\d+)/g, min: 2,
  },
  // Зсув на нулі невідрізнюваний від відсутності зсуву.
  {
    file: 'src/modules/channels/domain/ari-batch.check.ts',
    axis: 'модифікатор точки збуту (Ц7)',
    scope: /\/\/ ── 9\. Ц7[\s\S]*?(?=\n\/\/ ── 10\.)/,
    some: { pattern: /priceModifierPercent:\s*(-?[\d.]+)/g, test: (v) => Number(v) !== 0, why: 'потрібен хоч один НЕНУЛЬОВИЙ модифікатор' },
  },
  // Вісь пари: з одним типом номера її наявність невидима. Лічиться в СЦЕНІ
  // про пару, не по файлу — інакше 'ut' із сусідніх сцен тримає «два різних».
  {
    file: 'src/modules/channels/domain/ari-batch.check.ts',
    axis: 'типів номера в координатах ціни (И15)',
    scope: /\/\/ ── 11\. Вісь ПАРИ[\s\S]*?(?=\nconsole\.log\('ari-batch:)/,
    distinct: /kind: 'rate'(?: as const)?, unitTypeId: '([^']+)'/g, min: 2,
  },
  {
    file: 'src/modules/channels/channex/channex.check.ts',
    axis: 'типів номера у дзеркалі пар (И15)',
    scope: /\/\/ ── 14\.1 Вісь ПАРИ[\s\S]*?(?=\n\/\/ ── 15\.)/,
    // Кожен запис дзеркала окремо — `['тариф', 'тип', 'їхній id']`. Перша
    // версія ловила лише перший запис виклику `pairMap(` і була зеленою від
    // сусідніх сцен: та сама виродженість, тільки в регулярці гейта.
    distinct: /\['[^']*',\s*'([^']+)',\s*'[^']*'\]/g, min: 2,
  },
  // Двері писачів: «вимкнене зʼєднання теж отримує чергу» невидиме з одним
  // увімкненим; «незмаплений тип не отримує» невидиме з одним змапленим.
  {
    file: 'src/modules/channels/api/outbox.check.ts',
    axis: 'увімкнене й вимкнене зʼєднання у фікстурі',
    distinct: /enabled: (true|false)/g, min: 2,
  },
  {
    file: 'src/modules/channels/api/outbox.check.ts',
    axis: 'змаплений і незмаплений тип у твердженнях',
    distinct: /unitTypeId: '(UT\d)'/g, min: 2,
  },
  // Дорослих у котируванні більше одного значення, і місткість засіву не
  // менша за найбільше з них: інакше «місткість» перевіряється числом, яке
  // засів не вміщає.
  {
    file: 'src/modules/pricing/data/nightly-price.check.ts',
    axis: 'дорослих у котируванні',
    distinct: /\badults:\s*(\d+)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/nightly-price.check.ts',
    axis: 'ночей у котируванні',
    some: { pattern: /\bnights:\s*(\d+)/g, test: (v) => Number(v) > 1, why: 'потрібна хоч одна ніч > 1' },
  },
];

/** Коментарі геть — блокові й рядкові; `://` у рядках лишається. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function values(src, pattern, group = 1) {
  const out = [];
  for (const m of src.matchAll(pattern)) out.push(m[group]);
  return out;
}

const problems = [];
let checked = 0;

for (const a of AXES) {
  const full = path.join(ROOT, a.file);
  if (!fs.existsSync(full)) {
    problems.push(`${a.file}: файла немає — рядок реєстру застарів, приберіть його`);
    continue;
  }
  const raw = fs.readFileSync(full, 'utf8');
  let region = raw;
  if (a.scope) {
    const m = raw.match(a.scope);
    if (!m) {
      problems.push(`${a.file}: вісь «${a.axis}» — сцену не знайдено (${a.scope}); заголовок сцени перейменовано? гейт нічого не лічить`);
      continue;
    }
    region = m[0];
  }
  const src = stripComments(region);
  checked++;

  if (a.distinct) {
    const seen = new Set(values(src, a.distinct));
    const min = a.min ?? 2;
    if (seen.size < min) {
      problems.push(`${a.file}: вісь «${a.axis}» — ${seen.size} різних значень (${[...seen].join(', ') || 'жодного'}), треба ≥ ${min}: `
        + 'з одним значенням твердження зелене і з віссю, і без неї');
    }
  }
  if (a.some) {
    const all = values(src, a.some.pattern);
    if (!all.some(a.some.test)) {
      problems.push(`${a.file}: вісь «${a.axis}» — ${a.some.why}; знайдено: ${all.join(', ') || 'нічого'}`);
    }
  }
  if (a.pairs) {
    const found = [...src.matchAll(a.pairs)];
    if (!found.some((m) => m[1] !== m[2])) {
      problems.push(`${a.file}: вісь «${a.axis}» — усі пари однакові (${found.map((m) => `${m[1]}/${m[2]}`).join(', ') || 'жодної'}): `
        + 'два правила з однаковим числом невідрізнювані');
    }
  }
}

if (problems.length) {
  console.error('\n✗ фікстура вироджена по осі, про яку твердження стверджує (AGENTS інваріант 26):\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n  Твердження з такою фікстурою зелене в обох світах. Додайте друге значення осі');
  console.error('  й переконайтесь, що очікуване число несумісне з альтернативним прочитанням.');
  if (strict) process.exit(1);
} else {
  console.log(`  чисто — ${AXES.length} осей у ${new Set(AXES.map((a) => a.file)).size} перевірках, жодна фікстура не вироджена`);
}
