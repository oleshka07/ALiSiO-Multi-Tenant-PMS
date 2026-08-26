/**
 * Новий готель має список каналів, і він його мовою.
 *
 *   node src/core/booking-sources.check.ts
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * `booking_sources` наповнювалась в одному місці: у SQLite-міграції, яка
 * створює таблицю, і рівно для `properties LIMIT 1`. Список діставався
 * demo-seed, а кожен реальний готель стартував із порожньою таблицею — на
 * Postgres та міграція не виконується взагалі. На екрані це виглядало так:
 * кожна бронь із сірим бейджем «direct», однаковим для прямого гостя,
 * дзвінка й пошти, і звіт «звідки приходять гості» з однією колонкою.
 *
 * Друга половина гейта — структурна, і вона тут з тієї ж причини, з якої
 * зʼявився guest-page-content.check.ts: список, який ніхто не читає, нічим
 * не кращий за його відсутність. Файл із каналами може існувати, бути
 * бездоганним і не бути підключеним до provisionOrganization — і збірка про
 * це не скаже.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { DEFAULT_BOOKING_SOURCES, defaultBookingSources } from './booking-sources.ts';
import { LANGUAGE_CODES } from './i18n/languages.ts';

// ── Список, який справді щось перекриває ─────────────────────────────
assert.ok(DEFAULT_BOOKING_SOURCES.length >= 4, 'порожній список — це та сама порожня таблиця');

const codes = DEFAULT_BOOKING_SOURCES.map((s) => s.code);
assert.deepStrictEqual([...new Set(codes)], codes, 'коди каналів мусять бути унікальні');
assert.ok(codes.includes('direct'),
  '«direct» — саме той бейдж, який був сірим у кожної броні');
console.log(`  ok  новий готель отримує ${codes.length} каналів, серед них direct`);

// ── Мова готелю, а не мова автора продукту ───────────────────────────
//
// Німецькому готелю список каналів українською не допомагає жодного дня.
for (const lang of LANGUAGE_CODES) {
  const list = defaultBookingSources(lang);
  assert.strictEqual(list.length, DEFAULT_BOOKING_SOURCES.length,
    `мова ${lang} загубила канал`);
  for (const s of list) {
    assert.ok(s.name && s.name.trim(), `канал ${s.code} без назви для мови ${lang}`);
    assert.ok(!/^[a-z_]+$/.test(s.name),
      `канал ${s.code} для мови ${lang} показує код замість назви`);
  }
}
assert.strictEqual(defaultBookingSources('de')[0].name, 'Direkt');
assert.strictEqual(defaultBookingSources('uk')[0].name, 'Прямо');
// Мова поза списком падає в англійську, а не в українську: англійську
// прочитає більше персоналу, ніж мову автора продукту.
assert.strictEqual(defaultBookingSources('it')[0].name, 'Direct',
  'невідома мова мусить падати в англійську');
console.log(`  ok  назви каналів існують у всіх ${LANGUAGE_CODES.length} мовах`);

// ── Жодного OTA за замовчуванням ─────────────────────────────────────
//
// На яких майданчиках готель продає — це його бізнес-факт, і він називає їх у
// власному файлі. Засіяти Booking.com за замовчуванням означало б написати за
// готель, що він там продає, і покласти в звіт канал, якого в нього немає.
// Та сама помилка, що з «безкоштовною парковкою» на гостьовій сторінці.
for (const ota of ['booking', 'airbnb', 'expedia', 'hrs', 'agoda', 'ota']) {
  assert.ok(!codes.some((c) => c.includes(ota)),
    `«${ota}» у списку за замовчуванням — твердження про бізнес готелю, якого він не робив`);
}
console.log('  ok  майданчики називає готель, а не ми за нього');

// ── Список підключений там, де заводиться готель ─────────────────────
const provisioning = fs.readFileSync('src/core/provisioning.ts', 'utf8');
const code = provisioning.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(/defaultBookingSources\s*\(/.test(code),
  'provisionOrganization мусить кликати defaultBookingSources — інакше список є, а таблиця порожня');
assert.ok(/INSERT INTO booking_sources/.test(code),
  'канали мусять вставлятись при заведенні готелю, а не лише існувати у файлі');
// Усередині тієї самої транзакції (`t`), а не через пул: на Postgres друге
// зʼєднання не побачить ще не закомічений property і впаде на FK — цей самий
// урок уже коштував рядків із фічами.
//
// Дивимось рівно на той виклик, що несе цей INSERT: беремо текст від початку
// рядка з INSERT назад до найближчого `.run(`.
const at = code.indexOf('INSERT INTO booking_sources');
const before = code.slice(0, at);
const callAt = before.lastIndexOf('.run(');
assert.ok(callAt > 0 && at - callAt < 120,
  'не знайшов виклик, який виконує цей INSERT — гейт дивиться не туди');
const caller = before.slice(callAt - 12, callAt + 5);
assert.ok(/\bt\.run\($/.test(caller) && !/sql\.run\($/.test(caller),
  `канали мусять вставлятись через t.run усередині транзакції заведення, а не через пул (тут: «${caller.trim()}»)`);
console.log('  ok  канали засіваються там, де готель заводиться');

console.log('джерела бронювань: новий готель не стартує порожнім');
