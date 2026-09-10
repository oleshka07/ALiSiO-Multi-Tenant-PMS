/**
 * Маршрут, що відповідає БЕЗ СЕСІЇ, доводить своє право — і чим саме.
 *
 *   node scripts/check-public-routes.mjs            # звіт із розкладкою
 *   node scripts/check-public-routes.mjs --strict   # храповик, бігає в npm run check
 *
 * ── Навіщо, якщо є `check-route-guards` ─────────────────────────────────
 *
 * Бо той гейт саме ці маршрути **пропускає**: `check-route-guards.mjs:265`
 * робить `continue` на всьому, що збігається з `PUBLIC`. І це правильно —
 * вимагати від них варти означало б зламати гостьовий портал і віджет. Але
 * наслідок у тому, що на публічному контурі не стверджує НІЧОГО жоден гейт,
 * а саме туди приходить чужий браузер.
 *
 * Інваріант 4 каже про них дослівно: «виняток — публічний, і тоді він
 * доводить право іншим способом (токен, підпис, ідентифікатор орендаря в
 * запиті)». Три способи названі. Цей гейт питає, який із трьох тут, і
 * червоніє на четвертому — «ніякий».
 *
 * ── Три роди доказу, і вони НЕ рівноцінні ───────────────────────────────
 *
 *   `token`   — перепустка в самому запиті: `runWithPublicToken`, гостьовий
 *               токен, `export_token`, токен вебхука, підпис, секрет крона.
 *               Найсильніший: він доводить право на КОНКРЕТНИЙ рядок;
 *   `tenant`  — запит НАЗИВАЄ орендаря (`withSite`, `siteId`/`siteSlug`,
 *               `resolveSiteByKey`). Слабший: доводить, чий це готель, але не
 *               право на рядок — далі має працювати вісь обʼєкта (INC-029);
 *   `none`    — ні того, ні того. Це або справді відкриті дані (перевірка
 *               здоровʼя), або дірка. Кожен такий рядок мусить бути названий
 *               у `ALLOWED` нижче, з причиною.
 *
 * ── Чому храповик, а не «має бути нуль» ─────────────────────────────────
 *
 * `none` тут не завжди вада: `/api/health` навмисно нікому нічого не
 * доводить. Тому нуль недосяжний за побудовою, а список — фіксований:
 * новий маршрут без доказу валить збірку і мусить бути або полагоджений, або
 * названий тут словами. Той самий механізм, що в `audit-by-id-scope`.
 *
 * ── Що цей гейт НЕ доводить ─────────────────────────────────────────────
 *
 * Він читає, які ДВЕРІ маршрут відчиняє, а не чи правильно він ними
 * користується. `tenant` тут означає «орендаря названо», а не «прочитано лише
 * своє»; вісь обʼєкта всередині сторожить `check-property-scope`. Мовчання
 * цього гейта — не доведеність (AGENTS §3.2.1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

/**
 * Той самий перелік префіксів, що пропускає `check-route-guards`, плюс `cron`.
 *
 * Крон — теж «без сесії»: його будить розклад, а не людина, і право він
 * доводить секретом із оточення. Той гейт його не бачить, бо він не під
 * вартою й не в списку публічних; тут він на місці.
 */
const PUBLIC_PREFIX = /^(widget|booking|guest|public|webhooks?|health|cron|apps\/winhotel-import\/snapshots)(\/|$)/;

/**
 * Двері, які доводять право ПЕРЕПУСТКОЮ в самому запиті.
 *
 * ── Третя брехня цього гейта, і найповчальніша ──────────────────────────
 *
 * Спершу сюди входили `guest_page_token`, `guestToken`, `export_token`,
 * `webhook_token` — і `booking/reserve` виходив «доводить право токеном».
 * Він його не доводить: там ці слова стоять у `INSERT`, тобто маршрут токен
 * ВИДАЄ, а не питає. Це §3.2.1 дослівно: імʼя колонки — візерунок, а
 * властивість тут інша — «запит НЕ виконається без перепустки».
 *
 * Тому лишились двері, які саме гейтять, і жодного імені колонки.
 */
const TOKEN_DOORS = [
  'runWithPublicToken',
  'secretAuthFailure',
  // Двоє воріт крона, а не одні: `cron-auth` старший, `secretAuthFailure`
  // новіший, і половина кронів досі на першому. Гейт, який знав лише друге,
  // оголошував `cron/sync-cnb-rates` беззахисним — а він гейтиться першим.
  'cronAuthFailure',
  'connectionByWebhookToken',
  'verifySignature',
  // Токен агента Winhotel у заголовку: без нього прийом знімка відмовляє
  // 401 до першого байта (src/apps/winhotel-import/data/agent-token.ts).
  'organizationByAgentToken',
];

/**
 * Перепустка може стояти і в АДРЕСІ — тоді її видно зі шляху, а не з тексту.
 *
 * `guest/[token]/…` — сегмент і є перепусткою: без неї маршрут не існує.
 * Це властивість маршруту, і читається вона з імені теки, тобто не залежить
 * від того, як написаний хендлер.
 */
const TOKEN_IN_PATH = /\[token\]/;

/**
 * Двері, які НАЗИВАЮТЬ орендаря запитом.
 *
 * Лише `withSite`/`resolveSiteByKey` — вони роблять `runWithOrganization` і
 * відмовляють на невідомому ключі. Голі `siteId`/`siteSlug` сюди НЕ входять:
 * це імена полів тіла, і сама їх присутність не означає, що орендаря
 * встановлено, — саме на цьому гейт і збрехав би вчетверте.
 */
const TENANT_DOORS = [
  'withSite',
  'resolveSiteByKey',
];

/**
 * Те саме, зроблене рукою: сайт читається запитом і ставиться орендарем.
 *
 * `widget/config` і `booking/waitlist` не кличуть `withSite` — вони питають
 * `booking_sites` самі і йдуть у `runWithOrganization`. Це той самий доказ,
 * і зараховувати його треба: інакше гейт вимагав би переписати робочий код
 * заради власного словника (§3.2.1, випадок 7). Пара, а не одне слово:
 * `booking_sites` без `runWithOrganization` — це просто читання таблиці.
 */
const TENANT_BY_HAND = ['booking_sites', 'runWithOrganization'];

/**
 * Варта оператора. Маршрут із нею — НЕ безсесійний, хоч і лежить під
 * публічним префіксом: `booking/drafts-count` це бейдж чернеток в адмінці.
 * `check-route-guards` його теж не рахує — пропускає за префіксом, — тож він
 * не потрапляє в жоден із двох звітів. Тут він принаймні названий.
 */
const OPERATOR_GUARDS = ['withActor', 'withPermission'];

/**
 * Маршрути, яким нема чого доводити, — з причиною. Список, а не прапорець:
 * причина мусить бути написана, інакше наступний додасть сюди дірку.
 */
const ALLOWED = {
  'health': 'перевірка здоровʼя: віддає стан процесу і бази, жодного рядка клієнта',
  'booking/handshake': 'ВИДАЄ перепустку, тобто доводити нічого не може за побудовою; '
    + 'обмежує себе сам — одноразовий токен зі строком',
};

/**
 * Текст маршруту РАЗОМ із модулями, куди він пересилає.
 *
 * ── Перша редакція цієї функції брехала, і саме так, як §3.2 обіцяє ──────
 *
 * Вона брала будь-яке експортоване імʼя маршруту — тобто `GET` — і шукала в
 * усьому `src/` файл, який його ВИЗНАЧАЄ. `export async function GET` є в
 * десятках маршрутів, тож вона склеювала півдесятка чужих модулів і бачила в
 * них двері, яких у цьому маршруті немає: `/api/health` виходив «доводить
 * право токеном», а `guest/[token]` — «нічим». Обидва навпаки.
 *
 * Тому тепер простежуються лише ІМПОРТОВАНІ імена, і лише ті, що справді
 * стоять у якомусь `export` маршруту. Хендлер, написаний у самому файлі
 * маршруту, нікуди не веде — його текст і є весь текст.
 */
function handlerSources(routeFile) {
  const raw = fs.readFileSync(path.join(ROOT, routeFile), 'utf8');
  const out = [raw];

  // Що маршрут імпортує — тільки ці імена можуть вести в модуль.
  const imported = new Set();
  for (const m of raw.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) imported.add(name);
    }
  }
  // Що з імпортованого маршрут справді віддає як хендлер: або напряму
  // (`export const GET = getWidgetConfig`), або в обгортці
  // (`export const GET = async (…) => getGuestPortal(…)`).
  const used = [...imported].filter((name) =>
    new RegExp(String.raw`export[\s\S]{0,400}?\b${name}\b`).test(raw));
  if (used.length === 0) return out;

  for (const file of walk(path.join(ROOT, 'src'))) {
    if (!/\.tsx?$/.test(file) || /\.check\.tsx?$/.test(file)) continue;
    if (file.endsWith(`${path.sep}route.ts`)) continue;   // маршрут не веде в маршрут
    const text = fs.readFileSync(file, 'utf8');
    for (const name of used) {
      if (new RegExp(String.raw`export\s+(?:async\s+function|function|const)\s+${name}\b`).test(text)) {
        out.push(text);
        break;
      }
    }
  }
  return out;
}

/**
 * Кеш — ЗА ТЕКОЮ, а не один на всі.
 *
 * Друга брехня цього гейта, і теж мовчазна: спільний кеш наповнював перший
 * виклик (`src/app/api`), а другий (`src/`) діставав його ж. Тобто пошук
 * визначень хендлерів ішов лише по маршрутах — і не знаходив НІЧОГО, тож усі
 * тридцять маршрутів виходили «нічим». Число виглядало страшним і було
 * вигаданим.
 */
const cachedFiles = new Map();
function walk(dir) {
  if (cachedFiles.has(dir)) return cachedFiles.get(dir);
  const out = [];
  (function go(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) go(full);
      else out.push(full);
    }
  })(dir);
  cachedFiles.set(dir, out);
  return out;
}

/** Коментарі геть: гейт читає код, а не прозу про код (AGENTS §4). */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

const routes = [];
const guarded = [];
for (const file of walk(path.join(ROOT, 'src', 'app', 'api'))) {
  if (path.basename(file) !== 'route.ts') continue;
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const name = rel.replace(/^src\/app\/api\//, '').replace(/\/route\.ts$/, '');
  if (!PUBLIC_PREFIX.test(name)) continue;

  const sources = handlerSources(rel).map(stripComments).join('\n');
  if (OPERATOR_GUARDS.some((g) => sources.includes(g))) {
    guarded.push(name);
    continue;
  }
  const token = TOKEN_DOORS.filter((d) => sources.includes(d));
  if (TOKEN_IN_PATH.test(name)) token.push('перепустка в адресі');
  const tenant = TENANT_DOORS.filter((d) => sources.includes(d));
  if (TENANT_BY_HAND.every((d) => sources.includes(d))) tenant.push('booking_sites → runWithOrganization');
  routes.push({
    name,
    proof: token.length ? 'token' : tenant.length ? 'tenant' : 'none',
    doors: token.length ? token : tenant,
  });
}
routes.sort((a, b) => a.name.localeCompare(b.name));

const by = (kind) => routes.filter((r) => r.proof === kind);
const unexplained = by('none').filter((r) => !(r.name in ALLOWED));

if (!strict) {
  console.log('');
  console.log(`Маршрути без сесії — ${routes.length}. Чим доводять право:`);
  console.log(`(і ще ${guarded.length} під публічним префіксом, але ПІД ВАРТОЮ: `
    + `${guarded.join(', ')})`);
  console.log('');
  for (const kind of ['token', 'tenant', 'none']) {
    console.log(`  ${kind.padEnd(7)} ${String(by(kind).length).padStart(3)}`);
    for (const r of by(kind)) {
      const why = r.proof === 'none' ? (ALLOWED[r.name] ?? '⚠ НІЧИМ') : r.doors.join(', ');
      console.log(`      ${r.name.padEnd(38)} ${why}`);
    }
    console.log('');
  }
}

if (unexplained.length > 0) {
  console.log('');
  console.log('МАРШРУТ БЕЗ СЕСІЇ, ЯКИЙ НЕ ДОВОДИТЬ ПРАВО НІЧИМ (інваріант 4):');
  console.log('');
  for (const r of unexplained) console.log(`  ${r.name}`);
  console.log('');
  console.log('  Або перепустка в запиті (токен, підпис, секрет), або названий орендар');
  console.log('  (`withSite`), або рядок у ALLOWED цього гейта — з причиною словами.');
  process.exit(1);
}

console.log(`check-public-routes: ${routes.length} маршрутів без сесії — `
  + `${by('token').length} перепусткою, ${by('tenant').length} названим орендарем, `
  + `${by('none').length} нічим (усі названі)`);
