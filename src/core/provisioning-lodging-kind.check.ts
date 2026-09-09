/**
 * Рід житла новий готель НАЗИВАЄ. Мовчазного «hotel» немає.
 *
 *   node src/core/provisioning-lodging-kind.check.ts
 *
 * ── Навіщо ця перевірка існує ───────────────────────────────────────────
 *
 * Рішення власника В1 (09.09.2026): «має бути чіткий вибір, один раз
 * обирається і закріплюється за готелем». Причина не в акуратності даних, а
 * в грошах: менеджер каналів бере це поле за ОСНОВУ РАХУНКУ. Готельна група
 * (hotel, hostel, resort, …) тарифікується за ОБʼЄКТ, орендна (apartment,
 * villa, chalet, …) — за ЮНІТ. Підставлений `hotel` кемпінгу з двадцятьма
 * місцями означає чужий тариф, виставлений готелю без його відома, і
 * помітить це не код, а виписка першого числа.
 *
 * Той самий клас, що `|| 'CZK'` і `|| 'Europe/Prague'`: колонка заповнена,
 * значення схоже на правду, помилки ніде немає.
 *
 * ── Чому фікстура з ДВОХ родів ──────────────────────────────────────────
 *
 * Інваріант 26. Один готель роду `hotel` лишає твердження «рід ліг на
 * обʼєкт» зеленим і тоді, коли писач ігнорує аргумент і пише константу — бо
 * константа і є `hotel`. Вісь зʼявляється лише поруч із готелем, для якого
 * правильна відповідь ІНША, і вони арифметично несумісні: `camping` ≠
 * `hotel`. Роди взяті з РІЗНИХ груп тарифікації — саме тієї осі, заради
 * якої поле й називають.
 *
 * ── Що було червоним ────────────────────────────────────────────────────
 *
 * На коді до правки (`provisioning.ts` не мав ні поля, ні варти, а INSERT не
 * називав `property_type`) падали всі чотири твердження, і кожне своїми
 * словами:
 *
 *   1) «заведення без роду житла ПРОЙШЛО» — відмови не було взагалі;
 *   2) «рід житла на обʼєкті: null, чекали camping» — колонка лишалась
 *      порожньою, і синк каталогу відмовляв уже у вендора;
 *   3) те саме для сусіда, тобто вісь була вироджена з обох боків;
 *   4) «вигаданий рід прийнято» — `banana_resort` записався б у колонку.
 *
 * Доказ червоності — у звіті задачі, виводом прогону, а не переказом.
 */
import assert from 'node:assert';
import '../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { provisionOrganization } = await import('./provisioning.ts');
const { LODGING_KINDS } = await import('./lodging-kinds.ts');

const sql = getSql();
const SLUGS = ['probe-kind-camp', 'probe-kind-hotel', 'probe-kind-none', 'probe-kind-bogus'];
const PASSWORD = 'probe-lodging-kind-pw';

/** Прибирання називає кількість (Ц49) — як у сусідній перевірці поясу. */
async function cleanup() {
  for (const slug of SLUGS) {
    const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [slug]);
    if (!org) continue;
    await runWithOrganization(org.id, async () => {
      const props = await sql.rows<{ id: string }>(
        'SELECT id FROM properties WHERE organization_id = ?', [org.id]);
      for (const p of props) {
        await sql.run('DELETE FROM booking_sources WHERE property_id = ?', [p.id]);
        await sql.run('DELETE FROM categories WHERE property_id = ?', [p.id]);
      }
      await sql.run('DELETE FROM organization_features WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org.id]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
  }
}

/** Рід житла, який реально ліг на обʼєкт цього готелю. */
async function storedKind(organizationId: string, propertyId: string): Promise<string | null> {
  return await runWithOrganization(organizationId, async () => {
    const row = await sql.row<{ property_type: string | null }>(
      'SELECT property_type FROM properties WHERE id = ? AND organization_id = ?',
      [propertyId, organizationId]);
    return row?.property_type ?? null;
  });
}

await cleanup();

// ── Перелік у ядрі, і він не порожній ────────────────────────────────────
assert.ok(LODGING_KINDS.includes('hotel'), 'у переліку є hotel');
assert.ok(LODGING_KINDS.includes('camping'), 'і camping — інакше фікстура нижче нічого не розрізняє');

// ── Кемпінг: названий рід лягає на ОБʼЄКТ ────────────────────────────────
const camp = await provisionOrganization({
  name: 'Probe Kind Camp', slug: 'probe-kind-camp',
  ownerEmail: 'probe-kind-camp@probe.test', ownerPassword: PASSWORD,
  currency: 'EUR', language: 'uk', country: 'UA', lodgingKind: 'camping',
});
const campKind = await storedKind(camp.organizationId, camp.propertyId);
assert.equal(campKind, 'camping',
  `рід житла на обʼєкті — названий, а не константа писача (у базі: ${campKind ?? 'null'})`);
assert.equal(camp.lodgingKind, 'camping', 'заведення повертає рід, який поставило');

// ── Сусід-готель: друге значення тієї ж осі ──────────────────────────────
const hotel = await provisionOrganization({
  name: 'Probe Kind Hotel', slug: 'probe-kind-hotel',
  ownerEmail: 'probe-kind-hotel@probe.test', ownerPassword: PASSWORD,
  currency: 'CZK', language: 'cs', country: 'CZ', lodgingKind: 'hotel',
});
const hotelKind = await storedKind(hotel.organizationId, hotel.propertyId);
assert.equal(hotelKind, 'hotel', `сусід поїхав своїм родом (${hotelKind ?? 'null'})`);
assert.notEqual(campKind, hotelKind,
  'вісь: два готелі з різними родами мають різні значення в базі — інакше твердження вище '
  + 'зелене й тоді, коли писач ігнорує аргумент');

// ── Дві відмови: мовчазного дефолту немає ────────────────────────────────
//
// Пояс і країна названі в обох, щоб відмова, яка спрацює, була САМЕ про рід
// житла, а не про пояс поруч (§3.2.1: твердження мусить лишатись про свою
// вісь).
await assert.rejects(
  () => provisionOrganization({
    name: 'Probe Kind none', slug: 'probe-kind-none',
    ownerEmail: 'probe-kind-none@probe.test', ownerPassword: PASSWORD,
    currency: 'EUR', language: 'uk', country: 'UA',
  }),
  // Предмет, не ідентифікатор поля. Перша редакція вимагала `/lodgingKind/` —
  // тобто стерегла ВІЗЕРУНОК (англійську назву аргументу), і почервоніла на
  // правці, яка нічого не зламала: відмову переклали мовою продукту (§3.2.1).
  // Твердження ж про інше — що відмова НАЗИВАЄ РІД ЖИТЛА, а не мовчить і не
  // підставляє «hotel».
  /рід житла|роду житла/i,
  'роду житла не назвали — названа відмова, а не «hotel»',
);

await assert.rejects(
  () => provisionOrganization({
    name: 'Probe Kind bogus', slug: 'probe-kind-bogus',
    ownerEmail: 'probe-kind-bogus@probe.test', ownerPassword: PASSWORD,
    currency: 'EUR', language: 'uk', country: 'UA', lodgingKind: 'banana_resort',
  }),
  // І тут — саме ЗНАЧЕННЯ: «рід невідомий» без нього лишає того, хто заводить
  // готель, з питанням «а що я ввів», а вводив він його у файлі чи в команді.
  /banana_resort/,
  'роду, якого немає в переліку, не записуємо: вендор відмовив би вже посеред створення каталогу',
);

// ── Відмова НІЧОГО не лишає по собі ──────────────────────────────────────
//
// Варта стоїть до транзакції навмисно. Напівзаведений готель — організація
// без обʼєкта — виглядав би як робочий клієнт і мовчав би доти, доки хтось
// не спробує щось продати.
const halfway = await sql.rows<{ slug: string }>(
  'SELECT slug FROM organizations WHERE slug IN (?, ?)', ['probe-kind-none', 'probe-kind-bogus']);
assert.equal(halfway.length, 0,
  `відмова лишила по собі ${halfway.length} організац: ${halfway.map((r) => r.slug).join(', ')}`);

await cleanup();

const left = await sql.rows<{ slug: string }>(
  `SELECT slug FROM organizations WHERE slug IN (${SLUGS.map(() => '?').join(',')})`, SLUGS);
assert.equal(left.length, 0,
  `після прибирання лишилось ${left.length} організацій: ${left.map((r) => r.slug).join(', ')}`);

console.log('✓ provisioning-lodging-kind: рід житла називають, і він лягає на обʼєкт');
