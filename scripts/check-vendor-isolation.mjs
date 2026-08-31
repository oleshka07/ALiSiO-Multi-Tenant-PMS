/**
 * Вендор живе в одній теці, або порт нічого не вартий.
 *
 *   node scripts/check-vendor-isolation.mjs [--strict]
 *
 * Інваріант И1 (docs/CHANNEX-INTEGRATION.md §7): слово `channex`, заголовок
 * `user-api-key`, поняття «ревізія», «ack» і назви полів чужого API живуть
 * ТІЛЬКИ в `src/modules/channels/channex/`. Домен знає `ChannelManagerPort`
 * і доменні типи з `src/modules/channels/port.ts`.
 *
 * ЧОМУ ЦЕ ГЕЙТ, А НЕ ДОМОВЛЕНІСТЬ. Порт коштує пів дня, поки він цілий, і
 * не коштує нічого, щойно `room_type_id` протік у доменну функцію: заміна
 * менеджера каналів тоді знову означає переписати домен, тобто рівно те,
 * від чого порт мав захистити. Протікає це не рішенням, а по одному
 * полю — «тут швидше передати як є».
 *
 * Гейт НЕ обіцяє, що заміна вендора буде дешевою: мапінг і майстер
 * підключення переписуються в будь-якому разі (§3.2). Він обіцяє менше й
 * важливіше — що ядро при цьому не чіпають.
 *
 * ЩО ВВАЖАЄТЬСЯ ПРОТІКАННЯМ: ім'я вендора, його заголовок автентифікації,
 * імена полів його API. Слова на кшталт `availability` чи `rate` сюди НЕ
 * входять: це слова галузі, а не вендора, і заборонити їх означало б
 * зробити гейт нестерпним.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/** Тека адаптера — єдине місце, де все нижче дозволено. */
const ADAPTER = 'src/modules/channels/channex/';

/**
 * Маркери вендора.
 *
 * Кожен — або ім'я вендора, або те, що існує ЛИШЕ в його протоколі.
 *
 * `rate_plan_id` сюди НЕ входить, хоч і напрошується: це наша власна
 * колонка (`reservations.rate_plan_id`, таблиця `rate_plans`), і збіг імен
 * випадковий. Гейт із нею ловив віджет і `types/database.ts` — тобто
 * оголошував порушенням власну схему. Перевірено: з усього списку нижче в
 * `src/lib/db.ts` не зустрічається жодне, а `rate_plan_id` — чотири рази.
 *
 * Слова галузі (`availability`, `rate`, `min_stay`) теж не входять: вони
 * не належать вендору, і заборона на них зробила б гейт нестерпним.
 */
const MARKERS = [
  { re: /\bchannex\b/i, what: "ім'я вендора" },
  { re: /\buser-api-key\b/i, what: 'заголовок автентифікації вендора' },
  { re: /\bbooking_revisions?\b/i, what: 'ревізії бронювань — поняття вендора' },
  { re: /\broom_type_id\b/, what: "чуже ім'я типу номера (у домені unitTypeId)" },
  { re: /\bstop_sell\b/, what: 'поле вендора (у домені closed)' },
  { re: /\bmin_stay_(?:arrival|through)\b/, what: 'поле вендора' },
  { re: /\bclosed_to_(?:arrival|departure)\b/, what: 'поле вендора (у домені noArrival/noDeparture)' },
];

/**
 * Коментарі вирізаються ПЕРЕД пошуком (AGENTS.md §4).
 *
 * Інакше гейт ловить власні пояснення: `port.ts` мусить сказати, ЩО саме
 * він приховує, і зробити це, не назвавши жодного з прихованих слів,
 * неможливо. Так уже ловилися на собі `currency.check` і `invoicing.check`.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Файли, яким вендор дозволений поза адаптером, із причиною.
 *
 * Порожньо навмисно: щойно тут з'явиться перший запис, порт перестане бути
 * портом. Список існує, щоб виняток довелося написати руками й пояснити, а
 * не додати мовчки.
 *
 * Порожнім він лишається й після появи шва зі світом — див. WIRING нижче:
 * там не виняток, а вужче правило.
 */
const ALLOWED = new Map();

/**
 * ШОВ КОМПОЗИЦІЇ: де адаптер приєднують до застосунку.
 *
 * Рівно один раз ім'я модуля вендора мусить бути написане — інакше жоден
 * маршрут до адаптера не дістанеться, і порт лишиться кресленням. Це не
 * протікання: протікання — це коли доменна функція починає РОЗУМІТИ чужі
 * поля, а тут файл лише каже «провайдер `channex` обслуговується ось цим
 * модулем» і більше не робить нічого.
 *
 * Тому не виняток, а вужче правило: у цих файлах ім'я вендора дозволене
 * ЛИШЕ в рядку `import` і лише в стрічковому літералі поруч із ним. Будь-яке
 * інше входження — поле, тип, умова, URL — валить гейт так само, як і всюди.
 * Тобто логіка сюди не переповзе: щойно з'явиться `if (provider ===` з
 * розгалуженням поведінки або чуже поле, файл стане порушником.
 *
 * Ознака, що правило перестало працювати: у списку більше одного файла на
 * провайдера, або файл із цього списку виріс за десяток рядків.
 */
const WIRING = new Map([
  ['src/modules/channels/providers.ts',
    'шов композиції: рядок провайдера з cm_connections → модуль адаптера, і нічого більше'],
]);

/** Чи це рядок, у якому шву композиції дозволено назвати вендора. */
function isWiringLine(line) {
  const t = line.trim();
  return /^import\s/.test(t) || /^\s*await import\(/.test(t) || /^\['?[\w-]+'?,?$/.test(t)
    || /^['\"][\w-]+['\"]\s*[:,]/.test(t);
}

const offenders = [];

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
    if (rel.startsWith(ADAPTER)) continue;
    if (ALLOWED.has(rel)) continue;

    const text = stripComments(fs.readFileSync(p, 'utf8'));
    const wiring = WIRING.has(rel);

    // У шві композиції перевіряємо ПОРЯДКОВО: import — можна, решта — ні.
    // Так дозвіл лишається завширшки в один рядок і не стає дозволом на файл.
    if (wiring) {
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isWiringLine(lines[i])) continue;
        const marker = MARKERS.find((m) => m.re.test(lines[i]));
        if (marker) offenders.push({ rel, line: i + 1, what: `${marker.what} поза рядком import` });
      }
      continue;
    }

    for (const marker of MARKERS) {
      const idx = text.search(marker.re);
      if (idx < 0) continue;
      offenders.push({ rel, line: text.slice(0, idx).split('\n').length, what: marker.what });
      break;
    }
  }
}

walk(SRC);

let failed = false;

if (offenders.length) {
  failed = true;
  console.error(`\n✗ вендор протік за межі ${ADAPTER}:\n`);
  for (const o of offenders) console.error(`  ${o.rel}:${o.line} — ${o.what}`);
  console.error('\n  Домен розмовляє з менеджером каналів через ChannelManagerPort');
  console.error('  (src/modules/channels/port.ts) і доменними типами. Переклад у чужі');
  console.error('  імена — робота адаптера, і вона має лишатись у ньому одному.');
}

if (!failed) {
  const wired = WIRING.size === 1 ? 'шов композиції один' : `швів композиції: ${WIRING.size}`;
  console.log(`✓ vendor isolation: чужі імена не виходять за ${ADAPTER} (${wired})`);
}

if (failed && strict) process.exit(1);
if (failed) console.error('\n(режим звіту — --strict завалив би збірку)');
