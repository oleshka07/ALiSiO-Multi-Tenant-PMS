/**
 * Писач наявності або ціни, який не сказав каналам, — мовчазна стара ціна.
 *
 *   node scripts/check-outbox-writers.mjs [--strict]
 *
 * ── Клас помилки ────────────────────────────────────────────────────────
 *
 * Черга `cm_outbox` (0054) тримає координати «що змінилось»; батчер шле
 * поточне число. Але координату має ХТОСЬ покласти — у тій самій
 * транзакції, що й сама зміна. 01.09.2026 карта писачів показала: жодного
 * виклику в `src/` — кожна бронь, блокування і правка ціни мовчали. Це не
 * ламається: бронь створюється, ціна зберігається, канал далі продає за
 * старим. Помилки немає ніде, доки гість не приїде в проданий двічі номер.
 *
 * Тому це гейт, а не домовленість: файл, який пише в таблицю наявності або
 * ціни, мусить імпортувати двері `@channels/outbox` (у самому модулі каналів —
 * `outbox-notes`). Виняток — лише файл, названий нижче з причиною: він пише
 * колонки, від яких ні наявність, ні ціна не залежать.
 *
 * Гейт НЕ доводить, що виклик стоїть у правильному місці й у транзакції —
 * це читається очима і тримається перевірками дверей та писачів. Він
 * доводить менше й важливіше: нового писача без дверей не буде.
 *
 * Коментарі вирізаються перед пошуком (AGENTS §4).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Таблиці, з яких батчер читає значення (И3, інваріант 16) — і всі їхні писачі. */
const TABLES = [
  'reservations', 'availability_blocks', 'units', 'unit_types',
  'price_calendar', 'price_occupancy', 'price_los_tiers', 'rate_plans',
  // Ц30/Ц31: надбавки й правила міняють ціну, яка їде опціями заселеності.
  'extra_occupancy_rules', 'price_rules',
];

/** Писачі, які торкаються лише колонок, від яких наявність і ціна не залежать. */
const ALLOWED = new Map([
  ['src/modules/guests/data/registration.repo.ts', 'registration_status — стан реєстрації гостя, не ночі'],
  ['src/modules/bookings/api/reservation-registrations.handlers.ts', 'registration_status'],
  ['src/app/api/cron/abandoned-carts/route.ts', 'internal_notes — позначка листа'],
  ['src/app/api/cron/guest-reminders/route.ts', 'internal_notes — позначка листа'],
  ['src/app/api/payments/route.ts', 'payment_status — гроші, не ночі'],
  ['src/modules/finance/api/operations.handlers.ts', 'payment_status'],
  ['src/modules/guests/api/payment-request.handlers.ts', 'payment_status — гроші, не ночі'],
  ['src/modules/properties/api/photos.handlers.ts', 'photos — картинки типу, не місткість і не ціна'],
  ['src/modules/properties/data/cleaning.repo.ts', 'cleaning_status — стан прибирання номера, не наявність і не ціна (0092)'],
  ['src/modules/bookings/data/payment-status.repo.ts', 'payment_status — гроші, не ночі (В3: єдиний перерахунок із фоліо)'],
  ['src/lib/db.ts', 'схема й засів'],
  // Фікстура перевірок: сіє в тимчасову базу свого `.check.ts`, яку жоден
  // канал ніколи не бачить. Двері черги тут не «забуті» — вони були б
  // неправдою: координата в черзі означає «у вендора застаріло число», а
  // вендора в цієї бази немає. Файл не має суфікса `.check.ts` навмисно —
  // це модуль, який КЛИЧУТЬ перевірки, а не запускають.
  ['src/core/fixtures/two-properties.ts', 'фікстура перевірок: тимчасова база, у якої немає жодного каналу'],
]);

// Обгортка модуля (`stay-notes` у bookings) рахується дверима: вона сама імпортує
// @channels/outbox, а писачі кличуть її, щоб не переписувати одне й те саме.
//
// `reservation-write.repo` — обгортка другого рівня, і рахується з тієї самої
// причини: це ТРАНЗАКЦІЯ зміни броні, і `noteStay` стоїть усередині неї, тим
// самим зʼєднанням (інваріант 11). Писач, який кличе її, кладе координату в
// чергу НАДІЙНІШЕ за того, хто кличе `noteStay` сам: там її неможливо
// поставити не в ту транзакцію. Без цього рядка гейт вимагав би від фасадів
// заселення (`checkin.repo.ts`) імпортувати двері, якими вони не
// користуються, — тобто зробити імпорт заради гейта (§3.2.1).
const DOOR = /from\s+['"](?:@channels\/outbox|@channels|\.{1,2}\/(?:api\/)?outbox(?:-notes)?|\.\/outbox-notes|\.\.\/data\/outbox-notes|\.{1,2}\/(?:data\/)?stay-notes|\.{1,2}\/(?:data\/)?reservation-write\.repo)['"]/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.check\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

const problems = [];
let writers = 0;
for (const full of walk(path.join(ROOT, 'src'))) {
  const rel = path.relative(ROOT, full).split(path.sep).join('/');
  const src = stripComments(fs.readFileSync(full, 'utf8'));
  const hits = TABLES.filter((t) => new RegExp(`\\b(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE|DELETE\\s+FROM)\\s+["'\`]?${t}\\b`, 'i').test(src));
  if (hits.length === 0) continue;
  writers++;
  if (ALLOWED.has(rel)) continue;
  if (DOOR.test(src)) continue;
  problems.push(`${rel} — пише ${hits.join(', ')}, а дверей @channels/outbox не імпортує`);
}

if (problems.length) {
  console.error('\n✗ писач наявності або ціни без дверей до черги каналів:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n  Кожна така зміна лишає канал зі старим числом без жодної помилки.');
  console.error('  Покладіть координату в тій самій транзакції: noteAvailabilityChanged /');
  console.error('  noteRatesChanged з @channels/outbox — або назвіть файл у ALLOWED із причиною,');
  console.error('  якщо він пише лише колонки, від яких ні наявність, ні ціна не залежать.');
  if (strict) process.exit(1);
} else {
  console.log(`  чисто — ${writers} писачів таблиць наявності й цін, кожен або кличе двері, або названий винятком`);
}
