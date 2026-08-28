/**
 * An operator route that never establishes who is calling, or which hotel.
 *
 *   node scripts/check-route-guards.mjs [--strict]
 *
 * The middleware only checks that a session_id cookie is PRESENT. It does not
 * validate it and it never derives an organization, so a handler that does not
 * go through one of the guards runs with no identity at all (see the note at
 * the top of core/auth/session.ts — this was once true of 59 routes).
 *
 * On SQLite that meant any logged-in user of any tenant could reach whatever
 * the route touched. On Postgres the row-level policies stop the damage, but
 * they stop the route too: with no organization set, a scoped write is refused
 * outright and a scoped read quietly returns nothing. So an unguarded operator
 * route is now both a security hole and a broken feature.
 *
 * A guard can be applied in three places, and all three count:
 *
 *   in the route file        export const POST = withActor(handler)
 *   in the module barrel     export const listAccounts = await withFinanceRead(_listAccounts)
 *   inside the handler       currentActor() … runWithOrganization(...)
 *
 * The middle one is the common shape here and is why a check that only reads
 * route files reports most of the API as unguarded. This one follows the export
 * through the barrel before deciding.
 *
 * Public routes are exempt by path: a guest, an embedded widget, a payment
 * gateway and a cron job have no session by definition, and each of those
 * establishes its tenant from what it does have — a site key, a reservation
 * token, a shared secret.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * A guard establishes both things at once: who is calling, and — through
 * runWithOrganization — which hotel every query underneath belongs to.
 *
 * There are three families and they were written at different times, which is
 * exactly why this list has to be complete rather than remembered:
 *
 *   core/auth/session.ts        withActor, withPermission, withOwner
 *   core/security/route-guard.ts  requireFinanceAccess, requirePermission
 *   modules/finance/api/_guard.ts withFinanceRead, withPermission,
 *                                 withAnyPermission, asFinanceOwner
 *
 * Every one of them ends in `runWithOrganization(actor.organizationId, …)`;
 * that call, not the name, is what makes it a guard. A name missing from this
 * list is reported as unguarded, and a false accusation here costs more than a
 * miss — it sends someone to wrap a route that is already wrapped.
 */
const GUARDS = new RegExp([
  // `withModule` — особа + право + чи цей модуль у готеля є (core/auth/session.ts).
  // У словнику він, бо СПРАВДІ встановлює особу й орендаря, а не лише питає фічу:
  // обгортка, яка тільки читає `organization_features`, вартою не є.
  '\\bwith(Actor|Permission|AnyPermission|Owner|OwnedSite|FinanceRead|FinanceWrite|Site|Module)\\b',
  '\\brequire(FinanceAccess|Permission|FinanceUser)\\b', '\\basFinanceOwner\\b',
  // `runWithOrganization` — а НЕ `currentActor`. Той стояв тут поруч і був
  // єдиною діркою в цьому словнику: він встановлює особу й не встановлює
  // орендаря, тобто рівно те, від чого застерігає інваріант 4. Маршрут із
  // самим `currentActor` тепер класифікується як `hand` — див. HAND_ROLLED.
  //
  // Це коштувало `/api/auth/me`: він читав `organization_features` без
  // орендаря, політика не бачила рядків, `hasFeature` брав дефолт — і
  // вимкнені готелем модулі поверталися увімкненими. Гейт при цьому казав
  // «усі маршрути вкриті», бо бачив у тілі слово `currentActor`.
  '\\brunWithOrganization\\b',
].join('|'));

/**
 * Authentication done by hand, inside the handler.
 *
 *   const currentUser = await getSessionUser(cookieStore.get('session_id')?.value);
 *   if (!currentUser?.permissions.includes('manage_users')) return forbidden;
 *   … WHERE organization_id = ?
 *
 * core/auth/session.ts asks handlers not to do this, and the reason is now
 * concrete rather than stylistic: it establishes the person but not the tenant
 * context, so the row-level policies still see no organization. `app_users`
 * survives it because that table is deliberately readable before a tenant is
 * known; every other scoped table returns nothing at all. The route looks
 * authenticated, is authenticated, and shows an empty screen.
 *
 * Reported apart from the open ones: not a hole, but the same broken read.
 *
 * `currentActor` живе тут із тієї самої причини, з якої тут `getSessionUser`,
 * і різниця між ними лише в тому, що перший виглядав пристойніше. Обидва
 * відповідають на питання «хто», жоден — на питання «чий»; орендаря кладе на
 * зʼєднання тільки `runWithOrganization`. Хендлер, у тілі якого є обидва,
 * рахується вартою: 'guard' перевіряється раніше за 'hand'.
 */
const HAND_ROLLED = /\bgetSessionUser\b|\bresolveFinanceOwner\b|\bcurrentActor\b/;

/**
 * A shared secret instead of a session.
 *
 * Cron entry points authenticate with an environment secret, and there is
 * no session to wrap them in — finance/api/_guard.ts says so explicitly.
 * Recognised by what the route file actually reads rather than by where it
 * sits: /api/ical-sync/cron carries its own ICAL_CRON_SECRET and the two
 * channel-manager cron endpoints that used to be the other examples here had
 * no `cron` anywhere in their path at all. A list of paths would keep missing
 * them; what the file reads does not lie.
 */
// `cronAuthFailure`/`secretAuthFailure` are the shared implementation of the
// same thing — one place that refuses when the secret is unset, instead of the
// five hand-written spellings that used to fall back to a password printed in
// the source. A route that calls one of them IS checking a shared secret, and
// the gate has to know that or the refactor away from copy-paste reads as a
// route losing its guard.
const SHARED_SECRET = /\b(CRON_SECRET|INVESTOR_[A-Z_]*TOKEN|cronAuthFailure|secretAuthFailure)\b/;

/**
 * No session by definition, and each carries its own credential instead.
 *
 *   widget, booking, guest    a guest is not a user; a site key or a
 *                             reservation token says which hotel
 *   webhooks, payments        the gateway signs its callback
 *   cron, *-cron              CRON_SECRET — finance/api/_guard.ts says these
 *                             must NOT be wrapped in a session guard,
 *                             because there is no session to find
 *   platform/*                the supplier's own cookie, checked against
 *                             platform_users by each handler. Wrapping these
 *                             in withActor would demand a CUSTOMER session,
 *                             which by definition does not exist here — and
 *                             the one route that grants tenant access
 *                             (platform/enter) is the thing being guarded,
 *                             not a thing to guard with. What keeps this
 *                             honest is elsewhere: currentActor() gives a
 *                             platform session NO organization until it has
 *                             deliberately entered one, so every tenant route
 *                             still refuses it — ARCHITECTURE.md §3.3
 *   ical-export/[token]       the calendar feed URL is the credential
 *
 * Exempt from THIS check, not from scrutiny: each still has to establish its
 * tenant from whatever it does carry, which is what broke the widget price
 * list and the task digest.
 */
// `(?=/)` and not `\b`: a word boundary matches a hyphen, so `\b` after
// "booking" read `/api/booking-sources/[id]` as a public `/api/booking` route
// and skipped it. Those two handlers then sat unguarded for as long as the
// gate reported "every route is covered" — a neighbouring tenant could rename
// a sales channel, zero its commission or delete it. A prefix here must be a
// whole path segment, so the next character has to be a slash.
// `/api/auth/` більше не звільняється цілком. Звільнення отримали `login` і
// `logout` — у них сесії немає за визначенням, у цьому й суть. `me` сидів під
// тим самим префіксом і тому не перевірявся ЖОДНОГО разу, хоча він рівно
// протилежний: без сесії відповідає 401, а з сесією читає дані готеля.
// Сусідство з логіном не робить маршрут публічним.
const PUBLIC = new RegExp([
  '/api/auth/(login|logout)\\b',
  '/api/(widget|booking|guest|public|webhooks?|health)(?=/)',
  '/api/cron/', '/api/[^/]+/cron\\b', '/api/[^/]+/[^/]+/cron\\b', '-cron/',
  '/api/payments/webhook',
  '/api/platform/',
  '/api/ical-export/',
].join('|'));

// Read the alias table with a regex rather than JSON.parse: tsconfig.json is
// JSONC, and stripping its comments generically eats the `*` in `"@*.ts"`.
const aliases = {};
for (const m of fs.readFileSync('tsconfig.json', 'utf8')
  .matchAll(/"([^"]+)"\s*:\s*\[\s*"([^"]+)"/g)) {
  if (m[1].includes('*') || m[1].startsWith('@')) aliases[m[1]] = [m[2]];
}

/** Where an import specifier lands on disk. */
function resolveSpec(fromFile, spec) {
  let base;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else {
    const hit = Object.entries(aliases).find(([k]) => {
      const stem = k.replace(/\*$/, '');
      return k.endsWith('*') ? spec.startsWith(stem) : spec === k;
    });
    if (!hit) return null;
    const [key, [target]] = hit;
    base = path.resolve(target.replace(/\*$/, '') + spec.slice(key.replace(/\*$/, '').length));
  }
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.relative(process.cwd(), c);
  }
  return null;
}

/**
 * How `name`, as exported by `file`, establishes identity — following the
 * export through a barrel. 'guard' | 'hand' | 'open', strongest wins.
 */
function classifyExport(file, name, depth = 0) {
  if (depth > 3 || !fs.existsSync(file)) return 'open';
  const src = fs.readFileSync(file, 'utf8');

  // export const NAME = withX(...)  /  export const NAME = await withX(...)
  const assigned = src.match(new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*([^\\n;]+)`));
  if (assigned && GUARDS.test(assigned[1])) return 'guard';

  // export async function NAME — the guard, or the hand-rolled check, is in the body
  const declared = src.match(new RegExp(`export\\s+async\\s+function\\s+${name}\\b[\\s\\S]{0,3000}`));
  const body = declared?.[0].split(/\nexport /)[0];
  if (body && GUARDS.test(body)) return 'guard';
  if (body && HAND_ROLLED.test(body)) return 'hand';

  // A route that only dispatches: `export async function GET(req, ctx) {
  // return format === 'csv' ? exportRegistry(req, ctx) : getRegistry(req, ctx) }`.
  // The guard is on the handler it hands the request to, so follow the call —
  // otherwise a correctly guarded route is reported as open, and the report
  // sends someone to wrap what is already wrapped.
  if (body && depth <= 2) {
    const called = new Set([...body.matchAll(/\b([a-z]\w+)\s*\(\s*(?:request|req)\b/g)].map((m) => m[1]));
    for (const fn of called) {
      const via = followImport(file, src, fn, depth + 1);
      if (via === 'guard') return 'guard';
    }
  }

  // Re-exported from somewhere else: follow it.
  if (assigned) {
    const rhs = assigned[1].trim().replace(/;$/, '');
    if (/^\w+$/.test(rhs)) {
      const via = classifyExport(file, rhs, depth + 1);
      if (via !== 'open') return via;
      return followImport(file, src, rhs, depth);
    }
  }
  return followImport(file, src, name, depth);
}

function followImport(file, src, name, depth) {
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = m[1].split(',').map((s) => s.trim());
    const entry = names.find((n) => n.split(/\s+as\s+/).pop().trim() === name);
    if (!entry) continue;
    const original = entry.split(/\s+as\s+/)[0].trim();
    const target = resolveSpec(file, m[2]);
    if (target) return classifyExport(target, original, depth + 1);
  }
  // export { a, b } from './x'
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const entry = m[1].split(',').map((s) => s.trim())
      .find((n) => n.split(/\s+as\s+/).pop().trim() === name);
    if (!entry) continue;
    const target = resolveSpec(file, m[2]);
    if (target) return classifyExport(target, entry.split(/\s+as\s+/)[0].trim(), depth + 1);
  }
  return 'open';
}

const routes = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name === 'route.ts') routes.push(full);
  }
})('src/app/api');

const open = [];
const hand = [];
let checked = 0;
for (const file of routes) {
  if (PUBLIC.test('/' + file.replace(/^src\/app/, '').replace(/^\//, ''))) continue;
  const src = fs.readFileSync(file, 'utf8');
  if (SHARED_SECRET.test(src)) continue;
  for (const m of src.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
    checked++;
    const verdict = classifyExport(file, m[1]);
    const label = `${file.replace(/^src\/app/, '')}  ${m[1]}`;
    if (verdict === 'open') open.push(label);
    else if (verdict === 'hand') hand.push(label);
  }
}

console.log(`\nroute-guards: ${checked} операторських обробників`);
console.log(`  під вартою        ${checked - open.length - hand.length}`);
console.log(`  автентифікує сам  ${hand.length}\tособа є, орендаря немає`);
console.log(`  нічого            ${open.length}\tні особи, ні орендаря\n`);

if (open.length) {
  console.log('  ── ні особи, ні орендаря ────────────────────────────────────');
  for (const o of open) console.log('  ' + o);
  console.log(`
  Middleware вимагає, щоб cookie сесії БУВ, але не перевіряє його і не виводить
  організацію. Тож будь-який залогінений користувач будь-якого готелю сюди
  доходить — а на Postgres не доходить нічого: запис відхиляє політика,
  читання тихо повертає порожнє. Роут зламаний рівно настільки, наскільки
  відкритий.\n`);
}

if (hand.length) {
  console.log('  ── автентифікує сам, орендаря не встановлює ─────────────────');
  for (const h of hand) console.log('  ' + h);
  console.log(`
  Тут особа перевірена і права перевірені, дірки немає. Але контекст орендаря
  не виставлений, тож політики бачать порожню організацію: працює лише те, що
  читає app_users або booking_sites (їм читання до орендаря відкрите навмисно).
  Будь-яка інша scoped-таблиця поверне нуль рядків при цілком коректному
  запиті.\n`);
}

// --strict валить збірку на обох списках, і обидва зараз на нулі — гейт
// тримає лінію, а не приїжджає вже червоним.
//
// Раніше `hand` навмисно не гейтився: тих маршрутів було два десятки, і
// «падати на двадцяти відомих пунктах — це як перевірку обходять, а не
// виправляють». Причина зникла разом зі списком: останній був
// `/api/auth/me`, і коштував він рівно того, від чого застерігає інваріант
// 4 — вимкнені готелем модулі поверталися увімкненими, бо політика без
// орендаря не бачила рядків, а `hasFeature` читав «немає рядка» як «бери
// дефолт». Нуль, який ніхто не тримає, — це нуль до першого коміта.
if (process.argv.includes('--strict') && (open.length || hand.length)) process.exit(1);
