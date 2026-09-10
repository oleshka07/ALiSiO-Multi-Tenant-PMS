/**
 * Кожен ВХІД, який запускають у прод-образі, піднімається без `next/*`.
 *
 *   node scripts/check-entry-imports.mjs [--strict]
 *
 * ── Чому це гейт, а не випадок ──────────────────────────────────────────
 *
 * Next збирає standalone і вирізає з `node_modules` усе, чого не просить
 * рантайм застосунку: `node_modules/next/server.js` у прод-образі немає.
 * Локально він є завжди, тож імпорт, який його тягне, на стенді невидимий і
 * проявляється лише на сервері — після деплою, у скрипті, який хтось
 * запускає руками.
 *
 * За одну добу 06–07.09.2026 цей самий клас вистрілив чотири рази:
 *
 *   1. `apply-hotel.mjs` — `outbox-notes.ts` тягнув повний фасад `@pricing`;
 *      деплой бети звітував «не пройшов» на кроці звірки готельних файлів
 *      ПІСЛЯ підняття (`8cdbddc`), і виглядало це як «готель не збігається
 *      зі своїм файлом», тобто вказувало на дані клієнта;
 *   2. те саме вдруге (`8cbefeb`), бо перший раз полагодили один імпорт;
 *   3. `writer-imports.check` закрив ланцюжок ПИСАЧІВ — і рівно його;
 *   4. `channex-ari-live.mjs` — `await import('@channels')` тягне
 *      `channels/api/index.ts:1` → `ical-channels.handlers` → `next/server`.
 *      Живий прохід не запускався в образі взагалі, тобто перегравання
 *      сертифікації було заблоковане.
 *
 * Спільне в усіх чотирьох: гейт стеріг ОДИН ланцюжок, а вхід був інший.
 * Тому цей гейт не називає модулів. Він бере ВХОДИ — те, що DEPLOY.md і
 * протокол перегравання велять запускати як `node scripts/…` всередині
 * контейнера, — читає з кожного його власні `import`/`await import` і
 * вантажить саме їх, із гачком, який відмовляє на `next/*` так само, як
 * образ. Новий скрипт, який запускають на сервері, додається в `ENTRIES`
 * нижче; забутий там, але названий у DEPLOY.md, валить гейт сам.
 *
 * Це не аналіз тексту: якщо ланцюжок знову захопить обробники, тут упаде
 * саме імпорт, із назвою батьківського модуля в повідомленні.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Входи, які запускають у прод-образі.
 *
 * Живі проходи Channex додаються глобом: їх вісім, вони одного роду, і
 * забути новий — найлегший спосіб повторити випадок 4.
 */
const DECLARED = [
  'apply-hotel.mjs',
  'provision-org.mjs',
  'platform-user.mjs',
  'reset-password.mjs',
  'check-deployed-db.mjs',
  // Читає живу базу перед переїздом клієнта (DEPLOY.md §«Перед першим
  // справжнім клієнтом», пункт 4) — тобто запускається в прод-образі.
  'count-payer-folios.mjs',
  'encrypt-credentials.mjs',
  // Демо-проживання: `deploy.sh` кличе його одразу після звірки готельних
  // файлів, і він другий у дереві скрипт із власним резолвером аліасів
  // (`check-bare-node.mjs`). У DEPLOY.md його не запускають руками, тож
  // перехресна перевірка нижче до нього не дійде — звідси рядок тут (П5).
  'seed-demo-stays.mjs',
  // Наскрізний прохід заведення (Блок 8): піднімає застосунок і веде ДВА
  // готелі від нуля до фактури. Вхід у тому самому сенсі — його запускає
  // людина проти живого середовища, і `next/*` у ньому нема чому взятись.
  'check-onboarding-live.mjs',
];

const live = fs.readdirSync(path.join(ROOT, 'scripts'))
  .filter((f) => /^channex-.*-live\.mjs$/.test(f))
  .sort();

const ENTRIES = [...DECLARED, ...live];

// ── Вхід, названий у DEPLOY.md, але відсутній у списку — теж червоне ──────
//
// Інакше список розходиться з документом мовчки: наступний скрипт для
// оператора зʼявиться в DEPLOY.md і не зʼявиться тут.
const deploy = fs.readFileSync(path.join(ROOT, 'docs/DEPLOY.md'), 'utf8');
const named = [...deploy.matchAll(/node\s+scripts\/([a-z0-9-]+\.mjs)/g)].map((m) => m[1]);
const missing = [...new Set(named)].filter((f) => !ENTRIES.includes(f)).sort();

const problems = [];
for (const f of missing) {
  problems.push(`DEPLOY.md велить запускати scripts/${f}, а гейт його не перевіряє — допишіть у ENTRIES`);
}

// Аліаси СПЕРШУ, гачок ПОТІМ.
//
// `registerHooks` виконуються у зворотному порядку реєстрації: останній
// зареєстрований бачить специфікатор першим. Резолвер аліасів для `next/server`
// відповідає сам і до нашого гачка не делегує, тож зареєстрований раніше гачок
// цього імпорту НЕ БАЧИВ — і гейт був зелений на коді, який `next/server`
// таки тягне. Та сама пастка, що й скрізь: перевірка запускалась, але не
// перевіряла.
await import('./lib/module-aliases.mjs');

// ── Гачок: у прод-образі вхідних точок `next/*` немає ────────────────────
let current = '';
const hits = [];
registerHooks({
  resolve(spec, ctx, next) {
    // `next/dist/*` у образі є — вирізано саме вхідні точки (`next/server`,
    // `next/headers`). Ловимо їх, а не транзитивні файли: інакше в
    // повідомленні стоїть глибокий файл Next, а не наш модуль, який його
    // попросив.
    if (spec === 'next' || (spec.startsWith('next/') && !spec.startsWith('next/dist/'))) {
      hits.push(`${current}: ${spec} ← ${ctx.parentURL ?? '?'}`);
      throw new Error(`next/* у ланцюжку входу: ${spec} ← ${ctx.parentURL ?? '?'}`);
    }
    return next(spec, ctx);
  },
});

/** Специфікатори, які скрипт справді просить: статичні і динамічні. */
function specifiersOf(text) {
  const out = new Set();
  const patterns = [
    /\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.add(m[1]);
  }
  return [...out];
}

/** Чужі пакети не наші — нас цікавить лише власний граф і сам `next`. */
const OURS = (spec) => spec.startsWith('@') || spec.startsWith('.') || spec === 'next' || spec.startsWith('next/');

for (const entry of ENTRIES) {
  const file = path.join(ROOT, 'scripts', entry);
  if (!fs.existsSync(file)) {
    problems.push(`scripts/${entry} немає — список ENTRIES розійшовся з деревом`);
    continue;
  }
  current = `scripts/${entry}`;
  const text = fs.readFileSync(file, 'utf8');

  for (const spec of specifiersOf(text).filter(OURS)) {
    // Відносний шлях резолвиться від САМОГО скрипта, не від гейта: інакше
    // `../src/…` вказував би в інше місце й тихо не знаходився.
    const target = spec.startsWith('.')
      ? pathToFileURL(path.resolve(path.dirname(file), spec)).href
      : spec;
    try {
      await import(target);
    } catch (e) {
      // Нас цікавить лише `next/*`; решта — це модуль, який просить
      // оточення (ключ, базу), і на це гейт не претендує.
      if (!/next\/\*|next\/server|Cannot find module 'next/.test(String(e?.message))) continue;
      problems.push(`scripts/${entry} → ${spec}: ${String(e.message).split('\n')[0]}`);
    }
  }
}

const BAR = '═'.repeat(78);
console.log(`\n${BAR}`);
console.log('ВХІД, ЯКИЙ ЗАПУСКАЮТЬ У ПРОД-ОБРАЗІ, НЕ ТЯГНЕ next/*');
console.log(BAR);
const fromDeploy = DECLARED.filter((f) => named.includes(f)).length;
console.log(`\n  входів перевірено: ${ENTRIES.length} (${fromDeploy} названо в DEPLOY.md,`
  + ` ${DECLARED.length - fromDeploy} названо тут, ${live.length} живих проходів)`);

if (!problems.length && !hits.length) {
  console.log('  чисто — кожен вхід піднімається так само, як у образі\n');
  process.exit(0);
}

console.log('');
for (const p of problems) console.log(`  ✗ ${p}`);
// `hits` — кожен модуль, що попросив `next/*`; у звіті досить рядків по
// входах вище, решта тільки ховає їх під собою.
if (hits.length) console.log(`\n  (усього звертань до next/* у графах входів: ${hits.length})`);
console.log('\n  Вузькі двері замість повного фасаду — як @channels/outbox і @pricing/plans:');
console.log('  окремий файл, що реекспортує лише потрібне з шарів БЕЗ обробників.\n');
process.exit(strict ? 1 : 0);
