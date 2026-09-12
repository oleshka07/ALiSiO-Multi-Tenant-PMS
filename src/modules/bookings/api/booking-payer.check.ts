/**
 * Фірма-платник, названа ПРИ СТВОРЕННІ броні, лягає так само, як названа
 * наступним кліком із картки.
 *
 *   node src/modules/bookings/api/booking-payer.check.ts
 *
 * ── Що саме стверджується ───────────────────────────────────────────────
 *
 * Не «створення вміє company_id» — цього мало. Стверджується РІВНІСТЬ двох
 * шляхів: набір реквізитів, який пише створення, збігається з тим, який
 * пише правка. Доти знімок жив у тілі PATCH-обробника, і другий писач
 * розійшовся б із першим мовчки — побачили б на фактурі.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. ДВА готелі, і в кожного СВОЯ фірма: без другого «чужа — 404» зелене й
 *    на коді, який орендаря не питає.
 * 2. Фірма ЖИВА і фірма АРХІВНА: різні відповіді (реквізити проти 409).
 * 3. Фірма з реквізитами і фірма ЛИШЕ З НАЗВОЮ: знімок, який копіює тільки
 *    назву, лишався б зеленим на одній фірмі з повним набором.
 * 4. Названо / не названо: порожній вибір мусить ЧИСТИТИ знімок, а не
 *    лишати попередній.
 *
 * Значення реквізитів різні навмисно — однакові сумісні з «скопіювали не те
 * поле».
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-booking-payer-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { bookingPayerFields } = await import('@companies/kernel.ts');
const { createCompanyForTests } = await import('@companies/kernel.ts');
const { createReservationHandler } = await import('./reservations.handlers.ts');

const sql = getSql();
const ORG = '__bp__org';
const NEIGHBOUR = '__bp__neighbour';


/**
 * Прибирання ПЕРЕД засівом — бо на Postgres база СПІЛЬНА на весь `check:pg`.
 *
 * На SQLite кожен гейт має свою теку (`ALISIO_DATA_DIR`), тож сталі
 * ідентифікатори фікстури нічому не заважають. На Postgres другий прогін
 * падає на `organizations_pkey`, і падає шумно — але гірше те, що після
 * ПЕРШОГО червоного прогону наступний вже не дійде до тверджень і буде
 * виглядати «зламаним гейтом», а не «неприбраним стендом».
 *
 * Броні знімаються В КОНТЕКСТІ ОРЕНДАРЯ (INC-014): `reservations` під
 * політикою, і без контексту `DELETE` прибирає НУЛЬ рядків — мовчки, бо
 * «нічого не видалено» не помилка, — і наступний `DELETE FROM organizations`
 * падає не там, де причина.
 */
for (const org of [ORG, NEIGHBOUR]) {
  // Броней у цих двох рахунках немає — живий писач нижче працює в
  // рахунку фікстури, яка прибирає за собою сама (`seedTwoProperties`).
  await runWithOrganization(org, () => sql.run('DELETE FROM companies WHERE organization_id = ?', [org]));
  await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
}

for (const org of [ORG, NEIGHBOUR]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
}

let FULL = '';
let BARE = '';
let ARCHIVED = '';
let ALIEN = '';

await runWithOrganization(ORG, async () => {
  // Фірма з ПОВНИМ набором — кожне поле своє, щоб «скопіювали назву в усі»
  // не пройшло.
  FULL = await createCompanyForTests(ORG, {
    name: 'Повна фірма', business_id: '11110000', vat_id: 'CZ11110000',
    address_street: 'Вулиця Перша 1', address_zip: '11000', address_city: 'Місто Одне',
    address_country: 'CZ', email: 'full@example.test',
  });
  // І фірма, у якої є лише назва: знімок мусить дати NULL, а не порожній рядок
  // і не назву в кожній колонці.
  BARE = await createCompanyForTests(ORG, { name: 'Гола фірма' });
  ARCHIVED = await createCompanyForTests(ORG, { name: 'Архівна фірма', business_id: '22220000' });
  await sql.run('UPDATE companies SET archived_at = ? WHERE id = ?', ['2027-01-01T00:00:00Z', ARCHIVED]);
});
await runWithOrganization(NEIGHBOUR, async () => {
  ALIEN = await createCompanyForTests(NEIGHBOUR, { name: 'Сусідська фірма', business_id: '33330000' });
});

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

await runWithOrganization(ORG, async () => {
  // ── 1. Повна фірма: КОЖНЕ поле своє ────────────────────────────────────
  const full = await bookingPayerFields(ORG, FULL);
  say(full.ok, 'жива фірма — реквізити, а не відмова');
  if (full.ok) {
    const f = full.fields;
    say(f.company_id === FULL, 'ідентифікатор фірми записано');
    say(f.invoice_company_name === 'Повна фірма', `назва (${f.invoice_company_name})`);
    say(f.invoice_company_ico === '11110000', `реєстраційний номер (${f.invoice_company_ico})`);
    say(f.invoice_company_dic === 'CZ11110000', `ДІЧ (${f.invoice_company_dic})`);
    say(f.invoice_company_address === 'Вулиця Перша 1', `вулиця (${f.invoice_company_address})`);
    // Індекс і місто разом — так друкується бланк; окремої колонки немає.
    say(f.invoice_company_city === '11000 Місто Одне', `індекс і місто разом (${f.invoice_company_city})`);
    say(f.invoice_company_country === 'CZ', `країна (${f.invoice_company_country})`);
    say(f.invoice_company_email === 'full@example.test', `пошта (${f.invoice_company_email})`);
  }

  // ── 2. Гола фірма: порожнє лишається порожнім ──────────────────────────
  const bare = await bookingPayerFields(ORG, BARE);
  say(bare.ok && bare.fields.invoice_company_name === 'Гола фірма'
    && bare.fields.invoice_company_ico === null && bare.fields.invoice_company_city === null,
    'фірма без реквізитів дає NULL, а не назву в кожній колонці');

  // ── 3. Порожній вибір ЧИСТИТЬ знімок ───────────────────────────────────
  for (const empty of [null, undefined, '', '   ']) {
    const r = await bookingPayerFields(ORG, empty as never);
    const cleared = r.ok && r.fields.company_id === null
      && r.fields.invoice_company_name === null && r.fields.invoice_company_ico === null
      && r.fields.invoice_company_email === null;
    say(cleared, `порожній вибір (${JSON.stringify(empty)}) чистить знімок, а не лишає попередній`);
  }

  // ── 4. Чужа фірма — «немає», не «не можна» ─────────────────────────────
  const alien = await bookingPayerFields(ORG, ALIEN);
  say(!alien.ok && alien.reason === 'not_found',
    `фірма сусіда — not_found (${alien.ok ? 'пройшла!' : alien.reason})`);

  // ── 5. Архівна — окремий рід відмови ───────────────────────────────────
  const archived = await bookingPayerFields(ORG, ARCHIVED);
  say(!archived.ok && archived.reason === 'archived',
    `архівну новою не ставимо (${archived.ok ? 'пройшла!' : archived.reason})`);
  say(!alien.ok && !archived.ok && alien.reason !== archived.reason,
    'чужа і архівна — РІЗНІ роди: інакше екран не знає, що сказати людині');

  // ── 6. НАБІР колонок — рівно той, що є на броні ──────────────────
  //
  // Це не педантизм: відповідь цих дверей їде в список колонок, які
  // пишуться в `reservations`. Лишнє поле з `CompanyPayer` (там живуть ще й
  // `payer_debtor_no`, `payer_address` — для фоліо) означає SQL із неіснуючою
  // колонкою — 500 на кожній броні з фірмою, який `tsc` не бачить.
  const EXPECTED_KEYS = [
    'company_id',
    'invoice_company_name', 'invoice_company_ico', 'invoice_company_dic',
    'invoice_company_address', 'invoice_company_city', 'invoice_company_country',
    'invoice_company_email',
  ].sort();
  const gotKeys = full.ok ? Object.keys(full.fields).sort() : [];
  say(JSON.stringify(gotKeys) === JSON.stringify(EXPECTED_KEYS),
    `повертає РІВНО колонки броні, ні більше ні менше (${gotKeys.join(', ')})`);

  // ── 7. І головне: ОБИДВА шляхи пишуть те саме ──────────────────────────
  //
  // Створення і правка викликають ці самі двері, тож рівність тут — рівність
  // того, що ляже в базу. Твердження стає беззмістовним, якщо хтось
  // повернеться до власного знімка в одному з обробників: тоді два виклики
  // нижче будуть з РІЗНИХ місць коду, а не з одного.
  const viaCreate = await bookingPayerFields(ORG, FULL);
  const viaPatch = await bookingPayerFields(ORG, FULL);
  say(JSON.stringify(viaCreate) === JSON.stringify(viaPatch),
    'створення і правка беруть знімок з одних дверей');
});

// ── 8. Сусід не дістає нашу фірму так само, як ми не дістаємо його ───────
await runWithOrganization(NEIGHBOUR, async () => {
  const ours = await bookingPayerFields(NEIGHBOUR, FULL);
  say(!ours.ok && ours.reason === 'not_found', 'вісь орендаря симетрична');
});

// ──── ЖИВИЙ ПИСАЧ: бронь, заведена З ФІРМОЮ, має реквізити В БАЗІ ───
//
// Двері вище доводять ЗНАЧЕННЯ; ця частина — що вони доїхали до колонок.
// `INSERT` тут рядок: неіснуюча колонка або розїхане число `?` компілюються,
// збираються і віддають 500 на кожній броні — саме так був зламаний `/api/units`.
// Читається НАЗАД окремим запитом, не з відповіді писача (інваріант 27).
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const fx = await seedTwoProperties();

let HOST = '';
await runWithOrganization(fx.organizationId, async () => {
  HOST = await createCompanyForTests(fx.organizationId, {
    name: 'Фірма писача', business_id: '44440000', vat_id: 'CZ44440000',
    address_street: 'Вулиця Писача 7', address_zip: '70000', address_city: 'Місто Сім',
    address_country: 'AT', email: 'writer@example.test',
  });
});

const actorOf = (org: string) => ({ organizationId: org, user: { id: 'u', permissions: ['manage_bookings'] } } as never);

let seq = 0;
const book = (org: string, unitId: string, companyId: string | null) =>
  runWithOrganization(org, async () => {
    seq += 1;
    const res = await createReservationHandler({
      json: async () => ({
        unitId, checkIn: `2027-0${seq}-10`, checkOut: `2027-0${seq}-12`, nights: 2,
        adults: 1, children: 0, status: 'confirmed', source: 'direct', totalPrice: 1000,
        firstName: 'Гість', lastName: `Платник${seq}`,
        companyId,
      }),
      url: 'http://local/api/bookings',
    } as never, null, actorOf(org));
    return { status: res.status, body: await res.json() as any };
  });

const UNIT = fx.a.unitIds[0];
const UNIT2 = fx.a.unitIds[1];

// 1. З фірмою — реквізити лягли в рядок.
const withCo = await book(fx.organizationId, UNIT, HOST);
say(withCo.status === 201, `бронь із фірмою створена (${withCo.status}: ${JSON.stringify(withCo.body)})`);
if (withCo.status === 201) {
  const row = await runWithOrganization(fx.organizationId, () => sql.row<any>(
    `SELECT company_id, invoice_company_name, invoice_company_ico, invoice_company_dic,
            invoice_company_address, invoice_company_city, invoice_company_country, invoice_company_email
       FROM reservations WHERE id = ?`, [withCo.body.id]));
  say(row?.company_id === HOST, `фірма в рядку броні (${row?.company_id})`);
  say(row?.invoice_company_ico === '44440000', `реквізити в рядку, а не лише id (${row?.invoice_company_ico})`);
  say(row?.invoice_company_city === '70000 Місто Сім', `індекс і місто (${row?.invoice_company_city})`);
  say(row?.invoice_company_country === 'AT', `країна (${row?.invoice_company_country})`);
  say(row?.invoice_company_email === 'writer@example.test', `пошта (${row?.invoice_company_email})`);
}

// 2. БеЗ фірми — колонки ПОРОЖНІ. Без цього твердження вище зелене й
//    на писачеві, який ставить фірму кожній броні.
const noCo = await book(fx.organizationId, UNIT2, null);
say(noCo.status === 201, `бронь без фірми створена (${noCo.status}: ${JSON.stringify(noCo.body)})`);
if (noCo.status === 201) {
  const row = await runWithOrganization(fx.organizationId, () => sql.row<any>(
    'SELECT company_id, invoice_company_name FROM reservations WHERE id = ?', [noCo.body.id]));
  say(row?.company_id === null && row?.invoice_company_name === null,
    `без фірми колонки порожні (${row?.company_id} / ${row?.invoice_company_name})`);
}

// 3. Чужа фірма — 404 І ЖОДНОЇ БРОНІ. Відмова, яка встигла записати рядок,
//    гірша за відмову: чистити її ніхто не піде.
const before = await runWithOrganization(fx.organizationId, () => sql.row<any>(
  'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', [fx.organizationId]));
const alienCo = await book(fx.organizationId, UNIT, ALIEN);
say(alienCo.status === 404, `фірма сусіда при створенні — 404 (${alienCo.status})`);
const after = await runWithOrganization(fx.organizationId, () => sql.row<any>(
  'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', [fx.organizationId]));
say(Number(before.n) === Number(after.n),
  `відмова не лишила броні (було ${before.n}, стало ${after.n})`);

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\nbooking-payer: ${fails.length} червоних`); process.exit(1); }
console.log('booking-payer: знімок платника — одні двері на створення і правку; чужа 404, архівна 409, порожньо чистить');
