/**
 * Двоє не в'їжджають в один номер на одну ніч — і це тримає БАЗА (INC-045).
 *
 *   node src/modules/bookings/data/double-booking.check.ts
 *
 * ── Чому послідовних двох записів НЕ досить ─────────────────────────────
 *
 * Їх ловить і стара перевірка в коді: другий запис читає базу вже після того,
 * як перший ліг. Вада ж у ВІКНІ між «прочитали, вільно» і «записали»: у
 * `reservations.handlers.ts` між ними стоять дедуплікація гостя і запит
 * комісії — кілька походів у базу, і транзакції немає. Тому доказ тут один:
 * два записи ПАРАЛЕЛЬНО, обидва бачать вільно, і вижити мусить один.
 *
 * ── Чого ця сцена не доводить, і це чесно сказати ───────────────────────
 *
 * На SQLite вона доводить пару «черга + перевірка ВСЕРЕДИНІ черги», а не
 * обмеження: `EXCLUDE` там не існує. Справжнє обмеження доводиться лише під
 * `DB_DRIVER=postgres` — і тоді сцена сама каже, що саме її тримає. Зелень на
 * SQLite про обмеження бази не свідчить нічого; так само `check-isolation`
 * зеленів на свідомо зламаному коді під суперкористувачем (INC-014).
 *
 * Сама черга, без перевірки, не доводить НІЧОГО й на SQLite, і це знайшов
 * перший же прогін: серіалізація лише розводить писачів у часі, а другий із
 * них спокійно вставляє другу бронь — `пройшло 2`. Це записано тут, бо
 * «серіалізується транзакцією» звучить як достатня умова, а нею не є.
 *
 * ── Три осі, і кожна має пару ───────────────────────────────────────────
 *
 *   перетин проти сусідства: 10–12 і 11–13 конфліктують, 10–12 і 12–14 — ні,
 *     бо виїзд і заїзд в один день це не ніч (напівінтервал);
 *   службовий фонд: на `is_pool` дві броні на ті самі дати проходять ОБИДВІ —
 *     інакше кемпінг став би непродаваним;
 *   скасована бронь місця не тримає: та сама пара дат після `cancelled`
 *     проходить.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-double-booking-'));
if (process.env.DB_DRIVER !== 'postgres') process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { insertingStay, UnitOverlap } = await import('../api/overlap.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const onPostgres = sql.dialect.name === 'postgres';
const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(fx.organizationId, fn);

/** Той самий номер, ті самі ночі — рівно те, за що платять двічі. */
const ROOM = fx.a.unitIds[0];

let n = 0;
/**
 * Двері — ВСЕРЕДИНІ контексту орендаря, як у хендлерів: `insertingStay` на
 * SQLite сама ходить у базу (перевірка в черзі), а запит без орендаря на
 * Postgres тихо повернув би порожнє й «звільнив» зайнятий номер.
 */
const stay = (unitId: string | null, checkIn: string, checkOut: string, status = 'confirmed') => {
  const id = `dbl_${++n}`;
  return inOurs(() => insertingStay(
    () => sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                                 check_in, check_out, nights, adults, status, currency)
       VALUES (?, ?, ?, ?, '__two_props__guest', ?, ?, 2, 2, ?,
               (SELECT default_currency FROM organizations WHERE id = ?))`,
      [id, fx.organizationId, fx.a.id, unitId, checkIn, checkOut, status, fx.organizationId],
    ),
    { unitId, checkIn, checkOut },
  ));
};

/**
 * Скільки ЖИВИХ броней стоїть у номері на цих ночах.
 *
 * Вікно назване навмисно, і це не прикраса: фікстура сама садить броні на ці
 * самі номери (2026-09-10 на `unitIds[0]`), і лічильник «усі броні номера»
 * рахував би їх разом із нашими. Перший прогін так і зробив — сказав `2` там,
 * де насправді лежала одна наша бронь плюс одна чужа. Це той самий клас, що
 * інваріант 21: виміряно точно, але не те.
 *
 * Півінтервал `check_in < to AND check_out > from` — той самий, що в
 * обмеженні й у `stayOverlapsExisting`.
 */
const livingOn = async (unitId: string, from: string, to: string) => inOurs(async () => (await sql.rows(
  `SELECT id FROM reservations
    WHERE unit_id = ? AND status NOT IN ('cancelled', 'no_show')
      AND check_in < ? AND check_out > ?`, [unitId, to, from])).length);

// ── 1. ДВА ЗАПИСИ ПАРАЛЕЛЬНО — вижити мусить один ───────────────────────────
//
// `allSettled`, а не `all`: `all` відкинув би другу відповідь, щойно перша
// відмовила, і сцена не побачила б, ЩО саме сказала друга.
const both = await Promise.allSettled([
  stay(ROOM, '2027-03-10', '2027-03-12'),
  stay(ROOM, '2027-03-10', '2027-03-12'),
]);

const ok = both.filter((r) => r.status === 'fulfilled').length;
const refused = both.filter((r) => r.status === 'rejected');

assert.strictEqual(ok, 1,
  `на один номер і ті самі ночі мала пройти РІВНО одна бронь, пройшло ${ok}`);
assert.strictEqual(await livingOn(ROOM, '2027-03-10', '2027-03-12'), 1,
  'у базі лишилось не одне проживання на ці ночі — заборона не спрацювала');

// Відмова мусить бути НАЗВАНОЮ на обох двигунах: викликач має відрізнити
// «номер зайнято» від будь-якої іншої поломки бази, інакше канал не зможе
// відповісти на неї скиданням номера, а віджет — 409 з людським текстом.
// Двигуни різні (обмеження проти черги з перевіркою), обіцянка одна.
const why = (refused[0] as PromiseRejectedResult).reason;
assert.ok(why instanceof UnitOverlap,
  `відмова мала бути UnitOverlap, а не ${(why as Error)?.name}: ${(why as Error)?.message}`);
assert.strictEqual((why as InstanceType<typeof UnitOverlap>).unitId, ROOM,
  'відмова не назвала номер, через який сталася');

console.log(`  ok  два ПАРАЛЕЛЬНІ записи на один номер — вижив один, відмова названа UnitOverlap (${
  onPostgres ? 'тримає обмеження бази' : 'тримає черга з перевіркою; обмеження тут не існує — див. шапку'})`);

// ── 2. Сусідство — не перетин ───────────────────────────────────────────────
//
// Виїзд 12-го і заїзд 12-го — це різні ночі. Без цієї пари твердження вище
// зелене й на обмеженні, яке забороняє будь-які дві броні на номер.
await stay(ROOM, '2027-03-12', '2027-03-14');
assert.strictEqual(await livingOn(ROOM, '2027-03-12', '2027-03-14'), 1,
  'бронь, що починається в день виїзду попередньої, мала пройти — це не та сама ніч');
// І разом вони займають номер із 10-го по 14-те, не перетинаючись: дві броні
// у широкому вікні — при одній у кожному вузькому. Без цієї пари число «1»
// вище було б зеленим і на обмеженні, яке просто не пустило другу бронь.
assert.strictEqual(await livingOn(ROOM, '2027-03-10', '2027-03-14'), 2,
  'у номері мали стояти дві сусідні броні');

// А ось справжній перетин на одну ніч — не мала.
await assert.rejects(
  () => stay(ROOM, '2027-03-11', '2027-03-13'),
  'перетин на одну ніч мав бути відхилений',
);
console.log('  ok  10–12 і 12–14 сусідять і проходять; 11–13 перетинається і відхиляється');

// ── 3. Службовий фонд тримає багато броней НАВМИСНО ─────────────────────────
//
// Це найдорожча пастка міграції: пряме обмеження зробило б кемпінг і спільні
// номери непродаваними, і оператор побачив би відмову, якої не зрозуміє.
const POOL = fx.a.unitIds[1];
await inOurs(() => sql.run('UPDATE units SET is_pool = TRUE WHERE id = ?', [POOL]));
await stay(POOL, '2027-04-01', '2027-04-03');
await stay(POOL, '2027-04-01', '2027-04-03');
assert.strictEqual(await livingOn(POOL, '2027-04-01', '2027-04-03'), 2,
  'на службовому фонді дві броні на ті самі дати мали пройти ОБИДВІ');
console.log('  ok  службовий фонд: дві броні на ті самі ночі проходять обидві');

// ── 4. Скасована бронь місця не тримає ──────────────────────────────────────
const GONE = fx.a.unitIds[2];
await stay(GONE, '2027-05-01', '2027-05-03');
await inOurs(() => sql.run("UPDATE reservations SET status = 'cancelled' WHERE unit_id = ?", [GONE]));
await stay(GONE, '2027-05-01', '2027-05-03');
assert.strictEqual(await livingOn(GONE, '2027-05-01', '2027-05-03'), 1,
  'після скасування ті самі дати мали звільнитись');
console.log('  ok  скасована бронь звільняє ночі — той самий номер продається знову');

// ── 5. Бронь БЕЗ номера обмеження не стосується ─────────────────────────────
//
// Смуга «Без номера»: бронь із каналу, яку OTA вже продала, відхиляти не можна.
//
// Це твердження про ПОВЕДІНКУ, і воно навмисно не розрізняє, чи стоїть у
// предикаті `unit_id IS NOT NULL`: виміряно, що дві броні без номера проходять
// і БЕЗ цієї умови, бо gist-рівність `NULL = NULL` не істинна. Умова керує
// розміром індексу, а не правильністю — див. шапку міграції 0132.
await stay(null, '2027-03-10', '2027-03-12');
await stay(null, '2027-03-10', '2027-03-12');
console.log('  ok  дві броні без номера на ті самі ночі проходять — смуга «Без номера» жива');

if (process.env.DB_DRIVER !== 'postgres') fs.rmSync(tmp, { recursive: true, force: true });
console.log(`double-booking: ${onPostgres
  ? 'ОБМЕЖЕННЯ БАЗИ тримає паралельний запис'
  : 'черга з перевіркою тримає паралельний запис (SQLite; обмеження доводиться лише на Postgres)'}`);
