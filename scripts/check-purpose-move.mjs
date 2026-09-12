/**
 * Переїзд мети приїзду й візи в книгу гостей — на СТАРІЙ базі.
 *
 *   node scripts/check-purpose-move.mjs
 *
 * ── Навіщо окремий скрипт, а не `.check.ts` ─────────────────────────────
 *
 * Твердження тут — про МІГРАЦІЮ, тобто про перехід від бази, у якої колонки
 * ще є, до бази, у якої їх уже немає. Один процес такого не покаже: міграції
 * бігають один раз, на імпорті модуля бази, і на порожній теці колонок не
 * буває взагалі — гілка переїзду не виконується НІКОЛИ, а гейт зеленіє, бо
 * пішов іншим шляхом. Тому застосунок піднімається ДВІЧІ на одній теці, а між
 * проходами база штучно старіє: колонки додаються назад і в них кладуться
 * значення. Той самий прийом, що `check-fresh-schema --settles`.
 *
 * Постгресова половина того самого правила — у міграції 0416; вона зупиняє
 * деплой там, де тут друкується попередження (причина — в самій міграції).
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * Чотири пари з чотирма різними наслідками, і значення різні навмисно:
 *
 *   1. журнал 'Business' + 'V-1',    книга порожня  → переїхало
 *   2. журнал 'Tourism' + '',        книга порожня  → лишилось порожнім
 *   3. журнал 'Business' + 'V-3', книга вже 'Medical' → книга не змінилась
 *   4. журнал 'Tourism' + 'V-4',     книга порожня  → віза так, мета ні
 *
 * З однією парою будь-яке з трьох прочитань зелене: «переносить усе»,
 * «переносить нічого», «переписує книгу» — усі три сумісні з фікстурою на
 * одному рядку.
 *
 * ЧЕТВЕРТА пара додана після того, як злом NULLIF лишив гейт ЗЕЛЕНИМ: на
 * перших трьох рядок 2 відсікався зовнішньою умовою «у журналі є хоч щось
 * непорожнє» ще до того, як NULLIF мав що робити, тож твердження «вигадане не
 * переїжджає» насправді перевіряло іншу умову. Вигадана мета доїжджає до
 * COALESCE лише разом зі СПРАВЖНЬОЮ візою — це і є та пара. Класика
 * інваріанта 26: фікстура вироджена по осі, про яку твердження стверджує.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SELF = fileURLToPath(import.meta.url);

// ── Дочірній прохід: підняти базу (тобто прогнати міграції) і вийти ───────
if (process.env.ALISIO_PURPOSE_BOOT === '1') {
  await import('./lib/module-aliases.mjs');
  const { getDb } = await import('@core/db/index.ts');
  // База створюється ЛІНЬКУВАТО — самого імпорту мало (AGENTS §4). Запит і є
  // тим першим зверненням, після якого міграції справді відпрацювали.
  getDb().prepare('SELECT 1').get();
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-purpose-move-'));
const dbFile = path.join(tmp, 'alisio.db');

const boot = (label) => {
  const res = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SELF], {
    env: { ...process.env, ALISIO_PURPOSE_BOOT: '1', ALISIO_DATA_DIR: tmp },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error(`${label}: база не піднялась\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
  return `${res.stdout}${res.stderr}`;
};

boot('перший прохід');

// ── Постаріти базу: повернути колонки, які були до 0416, і засіяти ────────
const db = new Database(dbFile);
db.exec('ALTER TABLE guest_registrations ADD COLUMN purpose_of_stay TEXT');
db.exec('ALTER TABLE guest_registrations ADD COLUMN visa_number TEXT');

db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
  .run('__pm__org', 'Переїзд', '__pm__org');
db.prepare('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)')
  .run('__pm__prop', '__pm__org', 'Дім', '__pm__prop');

const pair = (n, guest, bookPurpose, logPurpose, logVisa) => {
  db.prepare('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)')
    .run(guest, '__pm__org', 'Гість', String(n));
  db.prepare(`INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out,
              nights, adults, status, currency)
              VALUES (?, ?, ?, ?, '2027-03-01', '2027-03-02', 1, 1, 'confirmed', 'EUR')`)
    .run(`__pm__r${n}`, '__pm__org', '__pm__prop', guest);
  db.prepare(`INSERT INTO reservation_guests (reservation_id, first_name, last_name, guest_id, purpose_of_stay)
              VALUES (?, 'Гість', ?, ?, ?)`)
    .run(`__pm__r${n}`, String(n), guest, bookPurpose);
  db.prepare(`INSERT INTO guest_registrations (id, reservation_id, guest_id, is_primary, reg_status,
              purpose_of_stay, visa_number) VALUES (?, ?, ?, 1, 'completed', ?, ?)`)
    .run(`__pm__gr${n}`, `__pm__r${n}`, guest, logPurpose, logVisa);
};

pair(1, '__pm__g1', null, 'Business', 'V-1');
pair(2, '__pm__g2', null, 'Tourism', '');
pair(3, '__pm__g3', 'Medical', 'Business', 'V-3');
pair(4, '__pm__g4', null, 'Tourism', 'V-4');
db.close();

const log = boot('другий прохід');

// ── Що вийшло ────────────────────────────────────────────────────────────
const after = new Database(dbFile, { readonly: true });
const fails = [];
const say = (cond, what) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const cols = after.prepare('PRAGMA table_info(guest_registrations)').all().map((c) => c.name);
say(!cols.includes('purpose_of_stay') && !cols.includes('visa_number'),
  `журнал згоди більше не має мети приїзду й візи (${cols.filter((c) => c === 'purpose_of_stay' || c === 'visa_number').join(', ') || 'немає обох'})`);

const book = (n) => after.prepare(
  'SELECT purpose_of_stay, visa_number FROM reservation_guests WHERE reservation_id = ?').get(`__pm__r${n}`);

const one = book(1);
say(one.purpose_of_stay === 'Business' && one.visa_number === 'V-1',
  `назване людиною переїхало в книгу (${JSON.stringify(one)})`);

const two = book(2);
say(!two.purpose_of_stay && !two.visa_number,
  `вигадане програмою НЕ переїхало — у книзі порожньо (${JSON.stringify(two)})`);

const three = book(3);
say(three.purpose_of_stay === 'Medical',
  `книга старша за журнал: те, що в ній уже стояло, не перезаписано (${three.purpose_of_stay})`);
say(three.visa_number === 'V-3',
  `а порожню половину того самого рядка все одно заповнено (${three.visa_number})`);

// Рядок, задля якого пара четверта: вигадана мета ЇДЕ ПОРУЧ зі справжньою
// візою, тобто доходить до самого COALESCE. Без цієї пари злом NULLIF
// лишався зеленим — рядок 2 відсікала зовнішня умова, а не правило.
const four = book(4);
say(!four.purpose_of_stay && four.visa_number === 'V-4',
  `віза переїхала, вигадана мета поруч із нею — ні (${JSON.stringify(four)})`);

// Індекси книги мусять пережити переїзд: у SQLite перебудова таблиці зносить
// їх мовчки, і саме так уже двічі зникало те, що мало забороняти (AGENTS §4).
const idx = after.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reservation_guests'").get().n;
say(idx > 0, `індекси книги гостей на місці (${idx})`);

say(/переїхали в книгу гостей, рядків: 3/.test(log),
  'мігратор доповів про переїзд рівно трьох рядків із чотирьох');

after.close();
fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\npurpose-move: ${fails.length} червоних`); process.exit(1); }
console.log('purpose-move: на старій базі назване переїжджає, вигадане ні, книга старша за журнал');
