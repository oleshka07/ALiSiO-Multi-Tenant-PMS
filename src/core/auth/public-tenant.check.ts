/**
 * Публічний маршрут називає орендаря.
 *
 *   node src/core/auth/public-tenant.check.ts
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * Інваріант 4 каже: кожен маршрут проходить через guard, а виняток —
 * публічний, і тоді він доводить право іншим способом. Гейт
 * `check-route-guards` перевіряє першу половину: маршрут або має варту, або
 * записаний у `PUBLIC_PREFIXES` в `src/proxy.ts`. Другу половину — «а чим
 * саме публічний доводить своє право» — не перевіряв ніхто, і рівно там
 * зламався `/api/public/availability`: він читав `reservations` без жодного
 * контексту орендаря.
 *
 * На SQLite політик немає, тож у розробці все виглядало правильно. На
 * Postgres зʼєднання З ПУЛУ, якому вже ставили орендаря, читає
 * `app.organization_id` як порожній рядок, який не збігається ні з чим:
 * запит повертає нуль рядків БЕЗ помилки. Порожній список зайнятих дат
 * календар віджета малює як «вільно все» — неправда гостю, без сліду в
 * логах. AGENTS.md §7 попереджає саме про цей клас.
 *
 * ── Що вважається доказом ───────────────────────────────────────────────
 *
 * Одне з трьох, і всі три вже існують у коді:
 *
 *   `withSite`               — ключ сайту з `booking_sites` (єдина таблиця,
 *                              читабельна до орендаря)
 *   `withGuest*`             — токен гостя з URL
 *   `runWithPublicToken`     — токен-перепустка на зʼєднанні (інваріант 14)
 *   `runWithOrganization`    — організація вже здобута іншим шляхом
 *   `requireOrganizationId`  — те саме, явно
 *
 * Плюс звичайні варти (`withActor`, `withPermission`, `withOwner`,
 * `withModule`): частина маршрутів під публічним префіксом насправді
 * операторські — `/api/ical-sync/channels` редагують канали з кабінету.
 *
 * ── Як воно шукає ───────────────────────────────────────────────────────
 *
 * Файл маршруту майже завжди тонкий: `export const GET = getAvailability`.
 * Тому перевірка йде за іменем: знаходить, де ця функція оголошена, і
 * дивиться шов там. Один рівень — далі шов не ховається, бо контекст
 * орендаря мусить обгортати ВЕСЬ хендлер, інакше половина запитів піде без
 * нього.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

/** Методи, які читають або пишуть дані. OPTIONS — це CORS-преліт, він порожній. */
const DATA_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const SEAMS = [
  'withSite',
  'withGuest',
  'withGuestReservation',
  'runWithPublicToken',
  'runWithOrganization',
  'requireOrganizationId',
  'withActor',
  'withPermission',
  'withOwner',
  'withModule',
  'withPlatformAdmin',
];

/**
 * Маршрути, яким орендар не потрібен, — з причиною. Кожен рядок тут
 * стверджує, що маршрут або не торкається даних орендаря, або сам його
 * встановлює всередині циклу по всіх готелях.
 */
const NO_TENANT_NEEDED = new Map<string, string>([
  ['api/auth/login', 'вхід за визначенням до орендаря: він його й обирає'],
  ['api/auth/logout', 'знищує кукі, до бази не ходить'],
  ['api/auth/me', 'читає власного користувача за сесією, не дані готелю'],
  ['api/platform/login', 'вхід постачальника — власні кукі й власні таблиці'],
]);

/**
 * Маршрути, які СЕРВІС кличе сам за розкладом: вони ходять по ВСІХ готелях,
 * тому обгорнути їх одним орендарем неможливо. Право доводиться секретом у
 * заголовку, а орендар ставиться всередині циклу — і саме це тут звіряється.
 */
const CRON_LOOPS = new Set(['api/cron', 'api/ical-sync/cron']);

const ROUTES = 'src/app/api';
const files: string[] = [];
(function walk(dir: string) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === 'route.ts') files.push(full);
  }
})(ROUTES);

/** Публічні префікси — з `proxy.ts`, а не з другого списку, який розійдеться. */
const proxy = fs.readFileSync('src/proxy.ts', 'utf8');
const prefixBlock = proxy.slice(proxy.indexOf('const PUBLIC_PREFIXES'), proxy.indexOf('\n];', proxy.indexOf('const PUBLIC_PREFIXES')));
const publicPrefixes = prefixBlock.split('\n')
  // Рядки-коментарі — геть. `'/api/file-upload'` згадується в тому блоці
  // САМЕ як «свідомо відсутній»; регулярка по всьому тексту заводила його в
  // публічні й вимагала орендаря від маршруту, який його вже має з варти.
  .filter((l) => !l.trim().startsWith('//'))
  .flatMap((l) => [...l.matchAll(/'(\/api\/[^']*)'/g)].map((m) => m[1].replace(/^\//, '')));
assert.ok(publicPrefixes.length > 0, 'PUBLIC_PREFIXES у proxy.ts не розібрався — перевірка дивиться не туди');

/**
 * Аліаси з tsconfig — щоб `@guests` вело у той самий файл, що й для
 * компілятора. Ім'я тут недостатньо: `handleCartEvent` оголошене двічі —
 * сирим хендлером у `cart.handlers.ts` і загорнутим у `withGuest` в барелі
 * `api/index.ts`. Маршрут імпортує друге; пошук за іменем знаходив перше і
 * оголошував захищений маршрут голим.
 */
const tsconfig = fs.readFileSync('tsconfig.json', 'utf8');
const aliases = new Map<string, string>();
for (const m of tsconfig.matchAll(/"(@[\w-]+)"\s*:\s*\[\s*"\.\/([^"]+)"/g)) aliases.set(m[1], m[2]);

function fileFor(spec: string, from: string): string | null {
  let base: string;
  if (aliases.has(spec)) base = aliases.get(spec)!;
  else if (spec.startsWith('@core/')) base = spec.replace('@core/', 'src/core/');
  else if (spec.startsWith('@/')) base = spec.replace('@/', 'src/');
  else if (spec.startsWith('.')) base = path.join(path.dirname(from), spec);
  else return null;
  for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/**
 * Тіло однієї функції, а не всього файлу.
 *
 * Спершу тут читався файл цілком, і це було помилкою, яку перевірка сама ж і
 * показала: маршрут імпортує `getSql` з `@core/db/async`, а той файл згадує
 * `runWithOrganization` у власному коді. Шов «знаходився» в кожному
 * маршруті, який просто ходить у базу, — тобто перевірка проходила завжди,
 * зокрема на тій самій ваді, заради якої написана.
 */
function functionBody(name: string, src: string): string | null {
  const decl = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${name}\\b`).exec(src)
    ?? new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?(?:function|const)\\s+${name}\\b`).exec(src);
  if (!decl) return null;
  let i = decl.index + decl[0].length;

  // `function` — спершу перестрибнути СПИСОК ПАРАМЕТРІВ. Без цього тілом
  // ставав тип аргументу: у `syncCnbRates(opts: { date?: string; … })`
  // перша ж фігурна дужка належить типу, і перевірка «читала» три рядки
  // сигнатури замість функції.
  if (/\bfunction\b/.test(decl[0])) {
    const lp = src.indexOf('(', i);
    if (lp < 0) return null;
    let d = 0;
    for (i = lp; i < src.length; i++) {
      if (src[i] === '(') d++;
      else if (src[i] === ')') { d--; if (d === 0) { i++; break; } }
    }
    const open = src.indexOf('{', i);
    if (open < 0) return null;
    d = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (d === 0) return src.slice(decl.index, j + 1); }
    }
    return src.slice(decl.index);
  }

  // `const` — усе до `;` на нульовій глибині: так само ловиться і
  // `export const GET = withGuest(_x);`, і `export const GET = withActor(
  // async (…) => { … });`.
  let paren = 0, brace = 0, brack = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') paren++; else if (c === ')') paren--;
    else if (c === '{') brace++; else if (c === '}') brace--;
    else if (c === '[') brack++; else if (c === ']') brack--;
    else if (c === ';' && paren === 0 && brace === 0 && brack === 0) return src.slice(decl.index, i + 1);
    else if (c === '\n' && paren === 0 && brace === 0 && brack === 0 && i > decl.index + decl[0].length + 2) {
      // Оголошення без крапки з комою, що вже закрилося.
      const rest = src.slice(decl.index, i);
      if (/[)}\w]\s*$/.test(rest) && !/=\s*$/.test(rest)) return rest;
    }
  }
  return src.slice(decl.index);
}

/** Куди веде ім'я `name`, як його бачить файл `from`: [файл, його текст]. */
function sourceOf(name: string, from: string): [string, string] | null {
  const src = fs.readFileSync(from, 'utf8');
  const imp = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
    .find((m) => m[1].split(',').some((p) => p.trim().split(/\s+as\s+/).pop()!.trim() === name));
  if (!imp) return null;
  let target = fileFor(imp[2], from);
  if (!target) return null;
  let body = fs.readFileSync(target, 'utf8');
  // Барель, що лише перепаковує (`export { x } from './y'`), — крок далі.
  for (let hop = 0; hop < 3; hop++) {
    if (functionBody(name, body)) break;
    const re = [...body.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
      .find((m) => m[1].split(',').some((p) => p.trim().split(/\s+as\s+/)[0].trim() === name));
    const star = re ? null : [...body.matchAll(/export\s+\*\s+from\s*'([^']+)'/g)]
      .map((m) => fileFor(m[1], target!))
      .find((f) => f && functionBody(name, fs.readFileSync(f, 'utf8')));
    const next = re ? fileFor(re[2], target) : star;
    if (!next) break;
    target = next;
    body = fs.readFileSync(next, 'utf8');
  }
  return [target, body];
}

/**
 * Чи встановлює `name` (як його бачить `from`) контекст орендаря — сам або
 * через те, що кличе. Обхід графу викликів, обмежений ТІЛАМИ функцій і
 * глибиною: контекст мусить обгортати весь хендлер, тож він або тут, або на
 * крок-два всередину, або його немає.
 */
function establishesTenant(name: string, from: string, depth = 0, seen = new Set<string>()): boolean {
  if (depth > 3) return false;
  const key = `${from}#${name}`;
  if (seen.has(key)) return false;
  seen.add(key);

  const found = sourceOf(name, from);
  const [file, src] = found ?? [from, fs.readFileSync(from, 'utf8')];
  const body = functionBody(name, src);
  if (!body) return false;
  if (SEAMS.some((s) => new RegExp(`\\b${s}\\s*[(<]`).test(body))) return true;

  // Не знайшли тут — дивимось, що це тіло кличе.
  for (const m of body.matchAll(/\b([a-z_]\w*)\s*\(/g)) {
    if (m[1] === name) continue;
    if (establishesTenant(m[1], file, depth + 1, seen)) return true;
  }
  return false;
}

const naked: string[] = [];
let checked = 0;

for (const file of files) {
  const route = path.dirname(file).replace(/^src[/\\]app[/\\]/, '').replace(/\\/g, '/');
  // Так само, як `proxy.ts`: порівняння по сирому префіксу, разом із косою
  // рискою на кінці. Зрізати її означало б записати в публічні
  // `booking-sites` (кабінет) через `booking/` і `guest-registry` через
  // `guest/` — тобто перевіряти не ту поверхню.
  if (!publicPrefixes.some((p) => route.startsWith(p))) continue;
  if (NO_TENANT_NEEDED.has(route)) continue;

  const src = fs.readFileSync(file, 'utf8');
  const isCron = [...CRON_LOOPS].some((c) => route.startsWith(c));

  for (const method of DATA_METHODS) {
    // `export const GET = handlerName` або `export async function GET(`.
    // `(?!\\s*[(<]|\\s*=>)` відсікає `export const GET = async (req…) => {`:
    // без нього іменем хендлера ставало слово `async`, пошук не знаходив
    // нічого, і обгортка навколо захищеного `getGuestPortal` оголошувалась
    // голою.
    // `(?![\\w]…)` — не косметика: без нього регулярка відкочувалась і з
    // `= withActor(` виймала `withActo`, бо після урізаного імені вже не
    // стоїть дужка. Пошук за таким іменем не знаходив нічого, і маршрут із
    // вартою оголошувався голим.
    const alias = src.match(new RegExp(`export\\s+const\\s+${method}\\s*=\\s*(?!async\\b)(\\w+)(?![\\w]|\\s*[(<]|\\s*=>)`));
    const inline = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`).test(src);
    if (!alias && !inline) continue;
    checked++;

    // Файл маршруту буває тонкою обгорткою — `export const GET = handle`,
    // `export const GET = getGuestPortal`, `export const GET = async (req) =>
    // getGuestPortal(req)`. Тому обхід іде від САМОГО експорту вглиб за
    // викликами, а не сканує файли.
    const entry = alias ? alias[1] : method;
    const seam = establishesTenant(entry, file);

    // Cron ходить по всіх готелях, тож орендар ставиться в циклі — але він
    // мусить там БУТИ, і секрет мусить перевірятись.
    if (isCron) {
      // Секрет доводиться двома способами: спільним `cronAuthFailure` і
      // власним `secretAuthFailure(request, 'ICAL_CRON_SECRET')`. Шукати
      // треба і в тілі хендлера — маршрут часто лише реекспорт.
      const authed = (n: string, f: string): boolean => {
        const found = sourceOf(n, f);
        const [, text] = found ?? [f, fs.readFileSync(f, 'utf8')];
        const b = functionBody(n, text);
        return !!b && /cronAuthFailure|secretAuthFailure|CRON_SECRET/.test(b);
      };
      const guarded = /cronAuthFailure|secretAuthFailure|CRON_SECRET/.test(src) || authed(entry, file);
      if (!guarded) naked.push(`${route} ${method} — cron без перевірки секрету`);
      if (!seam) naked.push(`${route} ${method} — cron ходить по готелях, але жодного разу не ставить орендаря`);
      continue;
    }

    if (!seam) naked.push(`${route} ${method}`);
  }
}

assert.ok(checked > 10, `перевірено лише ${checked} публічних методів — перевірка дивиться не туди`);
assert.deepStrictEqual(naked, [],
  'публічні маршрути без контексту орендаря:\n    ' + naked.join('\n    ') + '\n' +
  '  На Postgres такий запит не падає — він тихо повертає порожнє (читання)\n' +
  '  або відхиляється політикою (запис). Обгорніть хендлер у withSite /\n' +
  '  withGuest / runWithPublicToken, або додайте рядок у NO_TENANT_NEEDED\n' +
  '  з причиною, яку прочитає наступний.');
console.log(`  ok  ${checked} публічних методів встановлюють орендаря`);

// ── Віджет справді передає ключ сайту ───────────────────────────────────
//
// Маршрут, який чесно відмовляє без `site_id`, і скрипт, який його не шле, —
// це той самий зламаний віджет, лише з іншим кодом відповіді. Обидва боки
// шва перевіряються разом, бо поодинці кожен виглядає правильним.
const embed = fs.readFileSync('public/widget/embed.js', 'utf8');
const calls = [...embed.matchAll(/fetch\(\s*API_BASE \+ ([^)]*?)\)/gs)];
const tenantRoutes = ['/api/public/availability', '/api/booking/availability', '/api/widget/calendar'];
for (const route of tenantRoutes) {
  const uses = embed.split('\n').findIndex((l) => l.includes(route));
  assert.ok(uses >= 0, `embed.js більше не кличе ${route} — перевірку треба оновити`);
  // Ключ сайту підставляється в тому ж рядку або в сусідніх — беремо вікно.
  const window = embed.split('\n').slice(Math.max(0, uses - 3), uses + 3).join('\n');
  assert.ok(/SITE_ID/.test(window),
    `embed.js кличе ${route} без SITE_ID — на сервері з двома готелями це 404`);
}
assert.ok(calls.length > 0, 'жодного fetch у embed.js не знайдено — перевірка дивиться не туди');
console.log(`  ok  embed.js передає ключ сайту в ${tenantRoutes.length} виклики, що читають дані готелю`);

console.log('  ok  публічна поверхня: орендар названий, не вгаданий');
