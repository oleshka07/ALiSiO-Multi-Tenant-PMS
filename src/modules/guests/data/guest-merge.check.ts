/**
 * Двоє рядків — одна людина: злиття дублікатів гостя (INC-300, CORE-GAPS п. 11).
 *
 *   DB_DRIVER=postgres DATABASE_URL=… node src/modules/guests/data/guest-merge.check.ts
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * 37 тис. адрес в адресній книзі Winhotel: без злиття та сама людина ляже
 * десятки разів і розповзеться по бронях, фактурах і згодах, а після імпорту
 * дешево вже не полагодиться. Але дублікатів наробляє й портьє, щодня, у
 * будь-якому готелі — тож це ядро, а не імпортна обслуга.
 *
 * ── Три речі, яких тут треба боятись, і кожна має твердження ────────────
 *
 *   1. злиття ЧЕРЕЗ МЕЖУ ОРЕНДАРЯ. Два ідентифікатори приходять параметрами;
 *      чужий — це 404, а не «перенесли». Саме тому сцена бігає на Postgres:
 *      на SQLite політик немає і твердження зелене завжди;
 *   2. злиття із САМИМ СОБОЮ і ЛАНЦЮГ (A→B, потім B→C). Читач, який іде по
 *      `merged_into` без запобіжника, зациклиться. Обрано так: ланцюгів не
 *      буває за побудовою — злиття ПЕРЕНАЦІЛЮЄ старі посилання, тож
 *      `merged_into` завжди веде на живого одним кроком, і зливати вже
 *      злитого — відмова;
 *   3. ЗГОДИ при злитті. У однієї «маркетинг: так», у другої «ні». Правило
 *      суворіше: ВІДКЛИКАННЯ ПЕРЕМАГАЄ ЗГОДУ, завжди — інакше злиття стає
 *      способом розіслати листи тому, хто відмовився.
 *
 * ── Числа (інваріант 26) ────────────────────────────────────────────────
 *
 * У того, кого лишаємо, — 2 броні; у того, кого зливаємо, — 1. Сума 3 не
 * дорівнює жодному з доданків, тож «переніс не в той бік» і «не переніс
 * нічого» дають різні числа. Реєстрацій навмисно інша пара — 1 і 2, — щоб
 * переплутаний список був видний числом, а не лише назвою.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-guest-merge-'));
if (process.env.DB_DRIVER !== 'postgres') process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { isRefusal } = await import('@core/http/refusal.ts');
const { mergeGuests } = await import('./guest-merge.repo.ts');
const consents = await import('./guest-consents.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();
const ORG = fx.organizationId;

const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(ORG, fn);
const inTheirs = <T>(fn: () => Promise<T>) => runWithOrganization(neighbour.organizationId, fn);

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const guest = (organizationId: string, id: string, first: string, last: string) =>
  runWithOrganization(organizationId, () => sql.run(
    'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    [id, organizationId, first, last]));

let night = 1;
const booking = (guestId: string, id: string) => inOurs(() => sql.run(
  `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                             check_in, check_out, nights, adults, currency)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, 2, (SELECT default_currency FROM organizations WHERE id = ?))`,
  [id, ORG, fx.a.id, fx.a.unitIds[0], guestId,
    `2027-08-${String(night).padStart(2, '0')}`,
    `2027-08-${String(++night).padStart(2, '0')}`, ORG]));

const registration = (guestId: string, reservationId: string, id: string) => inOurs(() => sql.run(
  `INSERT INTO guest_registrations (id, reservation_id, guest_id, reg_status)
   VALUES (?, ?, ?, 'not_started')`, [id, reservationId, guestId]));

const countFor = (table: string, guestId: string) => inOurs(async () => Number(
  (await sql.row<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE guest_id = ?`, [guestId]))?.n ?? 0));

const mergedInto = (guestId: string) => inOurs(async () =>
  (await sql.row<{ merged_into: string | null }>(
    'SELECT merged_into FROM guests WHERE id = ?', [guestId]))?.merged_into ?? null);

await guest(ORG, 'gm_keep', 'Ірина', 'Коваль');
await guest(ORG, 'gm_drop', 'Ірина', 'Ковальська');

// 2 броні в того, кого лишаємо, 1 — у того, кого зливаємо.
await booking('gm_keep', 'gm_r1');
await booking('gm_keep', 'gm_r2');
await booking('gm_drop', 'gm_r3');
// Реєстрації навпаки: 1 і 2 — інша пара, ніж у броней.
await registration('gm_keep', 'gm_r1', 'gm_reg1');
await registration('gm_drop', 'gm_r3', 'gm_reg2');
await registration('gm_drop', 'gm_r3', 'gm_reg3');

// ── 1. Межа орендаря — обидва боки ──────────────────────────────────────────
await guest(neighbour.organizationId, 'gm_theirs', 'Чужа', 'Людина');
const across = async (keepId: string, dropId: string) => {
  try { await inOurs(() => mergeGuests({ organizationId: ORG, keepId, dropId })); return null; }
  catch (e) { return e; }
};
say(isRefusal(await across('gm_keep', 'gm_theirs')),
  'зливаємо ЧУЖОГО в свого — відмова, а не перенесення');
say(isRefusal(await across('gm_theirs', 'gm_drop')),
  'зливаємо свого в ЧУЖОГО — відмова теж (межа працює в обидва боки)');

// ── 2. Сам у себе ───────────────────────────────────────────────────────────
say(isRefusal(await across('gm_keep', 'gm_keep')),
  'злиття гостя із самим собою — відмова, а не порожня робота');

// ── 3. Саме злиття ──────────────────────────────────────────────────────────
await inOurs(() => mergeGuests({ organizationId: ORG, keepId: 'gm_keep', dropId: 'gm_drop' }));

say(await countFor('reservations', 'gm_keep') === 3,
  `усі 3 броні на тому, кого лишили (було 2 + 1)`);
say(await countFor('reservations', 'gm_drop') === 0,
  'на злитому не лишилось жодної броні');
say(await countFor('guest_registrations', 'gm_keep') === 3,
  'усі 3 реєстрації переїхали (було 1 + 2 — інша пара, ніж у броней)');

// ── 4. Злитого не видаляють ─────────────────────────────────────────────────
say(await mergedInto('gm_drop') === 'gm_keep',
  'рядок злитого ЛИШИВСЯ і показує, ким він став');

// ── 5. Ланцюга не буває: посилання перенацілюються ──────────────────────────
//
// A→B вже зроблено. Тепер B→C: якби `merged_into` лишався ланцюгом, читач
// мусив би розкручувати A→B→C і міг би зациклитись. Замість цього злиття
// перенацілює старі посилання, тож після другого злиття A веде на C НАПРЯМУ.
await guest(ORG, 'gm_final', 'Ірина', 'Коваль-Петренко');
await inOurs(() => mergeGuests({ organizationId: ORG, keepId: 'gm_final', dropId: 'gm_keep' }));
say(await mergedInto('gm_drop') === 'gm_final',
  'після другого злиття перший злитий веде на живого ОДНИМ кроком, без ланцюга');
say(await mergedInto('gm_keep') === 'gm_final', 'другий злитий теж веде на живого');
say(await countFor('reservations', 'gm_final') === 3, 'усі 3 броні дійшли до живого гостя');

// ── 6. Зливати вже злитого — відмова ────────────────────────────────────────
say(isRefusal(await across('gm_final', 'gm_drop')),
  'зливати вже злитого — відмова: це не жива особа, і мовчазне «ще раз» ховало б помилку');

// ── 7. ЗГОДИ: відкликання перемагає згоду ───────────────────────────────────
await inOurs(() => sql.run(
  `INSERT INTO consent_texts (id, organization_id, consent_kind, version, locale, body)
   VALUES ('gm_ct', ?, 'marketing', 'v1', 'uk', 'Згода на розсилку')`, [ORG]));

await guest(ORG, 'gm_yes', 'Олег', 'Згодний');
await guest(ORG, 'gm_no', 'Олег', 'Відмовник');
const consentFor = (guestId: string, source: string) => inOurs(() => consents.recordConsent({
  organizationId: ORG, guestId, consentKind: 'marketing', version: 'v1', source,
}));
await consentFor('gm_yes', 'reception');
await consentFor('gm_no', 'portal');
await inOurs(() => consents.revokeConsent({
  organizationId: ORG, guestId: 'gm_no', consentKind: 'marketing',
}));

await inOurs(() => mergeGuests({ organizationId: ORG, keepId: 'gm_yes', dropId: 'gm_no' }));
say(!(await inOurs(() => consents.marketingAllowed(ORG, 'gm_yes'))),
  'той, хто відмовився, переміг того, хто погодився — листів більше не буде');
say(await countFor('guest_consents', 'gm_yes') === 2,
  'обидва рядки згод збереглись — доказ лишається, змінилась лише чинність');

// ── 8. Пара до сьомого (§26) ────────────────────────────────────────────────
//
// Без неї твердження 7 зелене й на коді, який просто відкликає все підряд.
await guest(ORG, 'gm_yes2', 'Ольга', 'Перша');
await guest(ORG, 'gm_yes3', 'Ольга', 'Друга');
await consentFor('gm_yes2', 'reception');
await consentFor('gm_yes3', 'portal');
await inOurs(() => mergeGuests({ organizationId: ORG, keepId: 'gm_yes2', dropId: 'gm_yes3' }));
say(await inOurs(() => consents.marketingAllowed(ORG, 'gm_yes2')),
  'обидві погодились — після злиття згода ЖИВА (правило не «відкликати все»)');

// ── 9. Злитий гість НЕ ВОСКРЕСАЄ ────────────────────────────────────────────
//
// Найтихіша половина злиття, і без неї воно розвʼязується саме собою: писачі
// шукають гостя за поштою/телефоном/іменем, і якщо пошук бачить злитий рядок,
// наступна бронь тієї самої людини причепиться до МЕРТВОГО рядка — дублікат
// відроджується, а оператор бачить, що «злиття не тримається».
const { findOrCreateGuest } = await import('./guest-dedup.repo.ts');
const { listGuests } = await import('./guests.repo.ts');
const { searchGuests } = await import('./guest-search.ts');

// Пошта лежить ЛИШЕ на злитому рядку — навмисно. Якби вона була й на живому,
// твердження було б про те, який рядок першим віддасть `LIMIT 1` без сортування,
// тобто про порядок рядків рушія (INC-027), а не про злиття.
await inOurs(() => sql.run(
  "UPDATE guests SET email = 'dubl@example.com' WHERE id = 'gm_drop'"));

const found = await inOurs(() => findOrCreateGuest({
  organizationId: ORG, firstName: 'Ірина', lastName: 'Ковальська', email: 'dubl@example.com',
}));
say(found.id === 'gm_final' && !found.isNew,
  `дедуплікація віддала ЖИВОГО гостя, а не злитий рядок (віддала ${found.id}, isNew=${found.isNew})`);

const listed = await inOurs(() => listGuests(ORG, {}, 1, 200));
const ids = new Set(listed.data.map((g: { id: string }) => g.id));
say(!ids.has('gm_drop') && !ids.has('gm_keep') && ids.has('gm_final'),
  'у списку гостей злитих немає, а живий є');

// Порядок аргументів саме такий: `searchGuests(term, organizationId)`. Переплутані
// місцями, вони обидва рядки — `tsc` мовчить, а сцена «проходить» на порожньому
// результаті, тобто доводить не те (та сама помилка вимірювання, що INC-045).
const searched = await inOurs(() => searchGuests('Ковальська', ORG));
say(!searched.some((g: { id: string }) => g.id === 'gm_drop'),
  'пошук злитого не показує — інакше портьє обере мертвий рядок');

// Сусід не постраждав.
say(await inTheirs(async () => (await sql.row<{ merged_into: string | null }>(
  'SELECT merged_into FROM guests WHERE id = ?', ['gm_theirs']))?.merged_into ?? null) === null,
  'гість сусіда не зачеплений жодним зі злиттів');

if (process.env.DB_DRIVER !== 'postgres') fs.rmSync(tmp, { recursive: true, force: true });
assert.deepStrictEqual(fails, [], `не виконано: ${fails.join('; ')}`);
console.log('guest-merge: злиття переносить усе, лишає слід, не робить ланцюгів і не воскрешає відкликану згоду');
