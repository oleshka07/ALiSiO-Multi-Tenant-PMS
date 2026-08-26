/**
 * Кожен `/api/...`, який кличе екран, мусить існувати.
 *
 *   node scripts/check-dead-fetch.mjs --strict
 *
 * `check-embed-routes.mjs` стереже `public/widget/` — скрипти на чужих
 * сайтах. Цей стереже власні екрани, і потрібен він рівно з тієї ж причини,
 * якої там не було видно: TypeScript не знає, що рядок у `fetch()` — це
 * маршрут. Прибираєш інтеграцію, видаляєш теку `app/api/...`, збірка зелена,
 * а кнопка лишається на екрані й віддає 404.
 *
 * Так і сталося: після викорчовування Hostex на календарі лишилась кнопка
 * «Синхронізувати з Hostex» → `POST /api/hostex/sync`. Портьє тиснув її,
 * `res.json()` падав на HTML сторінки помилки, `catch` показував «Помилка
 * синхронізації» — тобто кнопка мала вигляд тимчасово зламаної, а не
 * прибраної. Знайшов її не гейт, а сторонній перегляд.
 *
 * ── Чому список дозволених рядків замість «нуль знахідок» ─────────────
 *
 * Кілька мертвих викликів уже відомі й чекають на рішення, більше за правку
 * рядка (див. AUDIT.md §2.6). Якби гейт падав на них, він падав би на кожному
 * коміті — і його вимкнули б. Тому вони перелічені тут ІМЕНОВАНО: список
 * видно в кожному прогоні, він може тільки коротшати, а будь-який НОВИЙ
 * мертвий виклик валить збірку.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const API_DIR = 'src/app/api';

/**
 * Відомі мертві виклики, кожен із причиною і з тим, що з ним робити.
 * Рядок звідси зникає разом із самим викликом — іншого способу немає.
 */
const KNOWN = new Map([
  ['/api/finance/paid-services',
    'сторінка «Оплачені послуги» має посилання з /app/finance, а маршруту немає — потрібен або звіт, або прибрати сторінку'],
  ['/api/guests/*/reservations',
    'мобільна картка гостя показує його попередні заїзди; маршруту немає, список завжди порожній'],
]);

/** Кожен route.ts на диску як URL, який він відповідає. */
function routePaths() {
  const found = new Set();
  const walk = (dir, url) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // [id] і [...path] відповідають будь-чому на цій позиції.
        walk(full, `${url}/${entry.name.startsWith('[') ? '*' : entry.name}`);
      } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
        found.add(url);
      }
    }
  };
  walk(API_DIR, '/api');
  return found;
}

function matches(url, routes) {
  if (routes.has(url)) return true;
  const parts = url.split('/');
  for (const route of routes) {
    const rp = route.split('/');
    if (rp.length !== parts.length) continue;
    if (rp.every((seg, i) => seg === '*' || parts[i] === '*' || seg === parts[i])) return true;
  }
  return false;
}

/** Файли екранів — усе під src/, крім самих маршрутів і перевірок. */
function screenFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full.replace(/\\/g, '/').startsWith(API_DIR)) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.check.ts')) {
        out.push(full);
      }
    }
  };
  walk('src');
  return out;
}

const routes = routePaths();
const problems = [];
const seenKnown = new Set();

for (const file of screenFiles()) {
  const src = fs.readFileSync(file, 'utf8');
  // Коментарі пояснюють маршрути, які кликали РАНІШЕ. Гейт, який не відрізняє
  // пояснення від виклику, падав би на власній документації.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const [, raw] of code.matchAll(/fetch\(\s*[`'"]([^`'"]*?\/api\/[^`'"]*)/g)) {
    // `${...}` — це або динамічний сегмент ([id] у маршруті), або приклеєний
    // рядок запиту. Різниця важлива: `/leads${qs}` — це маршрут `/leads`, а
    // не сегмент «leads плюс щось». Перший прогін гейта впав саме на цьому,
    // на власному ж коді вкладки «Форми».
    let url = raw.slice(raw.indexOf('/api/')).replace(/\$\{[^}]*\}/g, '\u0000');
    url = url.split('?')[0].replace(/\/+$/, '');

    const segments = url.split('/');
    let glued = false;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === '\u0000') { segments[i] = '*'; continue; }
      if (segments[i].includes('\u0000')) {
        // Підстановка приклеєна до сегмента: усе від неї — не шлях.
        segments[i] = segments[i].slice(0, segments[i].indexOf('\u0000'));
        segments.length = i + 1;
        glued = true;
        break;
      }
    }
    url = segments.join('/').replace(/\/+$/, '');
    if (!url.startsWith('/api/')) continue;
    if (!/^[/A-Za-z0-9_\-*.]+$/.test(url)) continue; // склеєний із змінної — не судимо
    // Приклеєний хвіст міг зрізати сегмент, тому маршрут-нащадок теж рахується.
    if (matches(url, routes)) continue;
    if (glued && [...routes].some((r) => r.startsWith(url))) continue;
    if (KNOWN.has(url)) { seenKnown.add(url); continue; }
    problems.push(`${file}: ${url}`);
  }
}

for (const [url, why] of KNOWN) {
  if (seenKnown.has(url)) console.log(`  ⊘ ${url} — ${why}`);
  else console.log(`  ✓ ${url} — виклику більше немає, рядок зі списку можна прибрати`);
}

if (problems.length) {
  console.error('\nЕкран кличе маршрут, якого немає:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nЗбірка цього не ловить: рядок у fetch() для TypeScript — просто рядок.');
  console.error('Користувач побачить кнопку, яка мовчки не працює.\n');
  if (STRICT) process.exit(1);
} else {
  console.log(`екрани кличуть лише наявні маршрути (${routes.size} на диску)`);
}
