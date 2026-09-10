/**
 * Згода живе на ОСОБІ й переживає бронь (INC-300, CORE-GAPS п. 6).
 *
 *   DB_DRIVER=postgres DATABASE_URL=… node src/modules/guests/data/guest-consents.check.ts
 *
 * ── Чому це блокер імпорту, а не покращення на потім ────────────────────
 *
 * У Winhotel `ADR_DATENSCHUTZ` — 61 305 рядків, і кожен висить на АДРЕСІ,
 * тобто на особі. У нас згода лежала на `guest_registrations`, у якої
 * `reservation_id` оголошено `NOT NULL`. Отже згоді людини, у якої в нашій
 * системі немає броні, не було куди лягти — а таких у тих 61 тисячі більшість.
 *
 * Полагодити це ПІСЛЯ імпорту не можна: даних уже не буде. Тому сцена стоїть
 * перед імпортом, а не після.
 *
 * ── Що саме стверджується ───────────────────────────────────────────────
 *
 *   1. згода записується гостю, у якого броні НЕМАЄ ЖОДНОЇ (сам випадок імпорту);
 *   2. згода ПЕРЕЖИВАЄ бронь: видалили бронь — згода на місці й читається;
 *   3. версія тексту обовʼязкова: згода на версію, якої в довіднику немає, —
 *      названа відмова, а не рядок. Згода без тексту не доводить нічого:
 *      людина погодилась на щось, а на що — невідомо. І пара до цього: версія,
 *      ЗНЯТА з обігу, нових згод не приймає, а вже дані на неї лишаються
 *      чинними — інакше «ми оновили текст» не означало б нічого, а оновлення
 *      знецінювало б наявні докази;
 *   4. відкликання НЕ ВИДАЛЯЄ рядка: `revoked_at` проставлено, рядок читається,
 *      і саме це показують наглядачеві. Рядка, якого немає, не досить у
 *      ОБИДВА боки — ні щоб довести згоду, ні щоб довести відкликання;
 *   5. похідне «чи можна слати листи» рахується з журналу, а не з окремої
 *      колонки: два джерела розійшлися б, і відповідало б те, яке спитали
 *      останнім;
 *   6. межа орендаря: гість сусіда — відмова, а не запис.
 *
 * ── Чому в `check:pg`, а не в `check` ───────────────────────────────────
 *
 * Твердження 6 має сенс лише під політиками. На SQLite політик немає, і воно
 * зелене завжди — тобто на SQLite сцена доводила б менше, ніж обіцяє назва.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-guest-consents-'));
if (process.env.DB_DRIVER !== 'postgres') process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { isRefusal } = await import('@core/http/refusal.ts');
const consents = await import('./guest-consents.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(fx.organizationId, fn);
const inTheirs = <T>(fn: () => Promise<T>) => runWithOrganization(neighbour.organizationId, fn);

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

/** Текст згоди — довідник із ВЕРСІЄЮ. Без нього згода нічого не доводить. */
const text = (organizationId: string, id: string, kind: string, version: string, body: string) =>
  runWithOrganization(organizationId, () => sql.run(
    `INSERT INTO consent_texts (id, organization_id, consent_kind, version, locale, body)
     VALUES (?, ?, ?, ?, 'uk', ?)`,
    [id, organizationId, kind, version, body]));

const guest = (organizationId: string, id: string, first: string, last: string) =>
  runWithOrganization(organizationId, () => sql.run(
    `INSERT INTO guests (id, organization_id, first_name, last_name)
     VALUES (?, ?, ?, ?)`, [id, organizationId, first, last]));

await text(fx.organizationId, 'ct_mk_1', 'marketing', 'v1', 'Згода на розсилку, редакція 1');
await text(fx.organizationId, 'ct_mk_2', 'marketing', 'v2', 'Згода на розсилку, редакція 2');
await text(neighbour.organizationId, 'ct_n_1', 'marketing', 'v1', 'Чужа згода');

// ── 1. Гість БЕЗ ЖОДНОЇ броні — сам випадок імпорту ─────────────────────────
await guest(fx.organizationId, 'gc_lonely', 'Оксана', 'Безброні');
await inOurs(() => consents.recordConsent({
  organizationId: fx.organizationId, guestId: 'gc_lonely',
  consentKind: 'marketing', version: 'v1', source: 'import',
}));
say(await inOurs(() => consents.marketingAllowed(fx.organizationId, 'gc_lonely')),
  'згода лягла гостю, у якого немає жодної броні (61 тис. рядків імпорту)');

// ── 2. Згода ПЕРЕЖИВАЄ бронь ────────────────────────────────────────────────
await guest(fx.organizationId, 'gc_stayed', 'Петро', 'Бувалий');
await inOurs(() => sql.run(
  `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                             check_in, check_out, nights, adults, currency)
   VALUES ('gc_res', ?, ?, ?, 'gc_stayed', '2027-06-01', '2027-06-03', 2, 2,
           (SELECT default_currency FROM organizations WHERE id = ?))`,
  [fx.organizationId, fx.a.id, fx.a.unitIds[0], fx.organizationId]));
await inOurs(() => consents.recordConsent({
  organizationId: fx.organizationId, guestId: 'gc_stayed',
  consentKind: 'marketing', version: 'v2', source: 'portal',
}));
await inOurs(() => sql.run("DELETE FROM reservations WHERE id = 'gc_res'"));

const afterBooking = await inOurs(() => consents.consentState(fx.organizationId, 'gc_stayed'));
say(afterBooking.marketing?.version === 'v2',
  `бронь видалено — згода на місці й памʼятає СВОЮ версію (${afterBooking.marketing?.version})`);

// ── 3. Версія тексту обовʼязкова ────────────────────────────────────────────
let refusedVersion: unknown = null;
try {
  await inOurs(() => consents.recordConsent({
    organizationId: fx.organizationId, guestId: 'gc_lonely',
    consentKind: 'marketing', version: 'v99', source: 'portal',
  }));
} catch (e) { refusedVersion = e; }
say(isRefusal(refusedVersion),
  'згода на версію, якої немає в довіднику, — НАЗВАНА відмова, а не рядок');

// ── 3.1 Знята з обігу редакція нових згод не приймає ────────────────────────
//
// Пара до попереднього: версія Є в довіднику, але вимкнена. Стара згода на неї
// лишається чинною (доказ нікуди не дівається), а нову взяти вже не можна —
// інакше «ми оновили текст» не означало б нічого.
await inOurs(() => sql.run(
  "UPDATE consent_texts SET is_active = FALSE WHERE id = 'ct_mk_1'"));
let refusedRetired: unknown = null;
try {
  await inOurs(() => consents.recordConsent({
    organizationId: fx.organizationId, guestId: 'gc_stayed',
    consentKind: 'marketing', version: 'v1', source: 'portal',
  }));
} catch (e) { refusedRetired = e; }
say(isRefusal(refusedRetired),
  'згода на ЗНЯТУ з обігу редакцію — відмова, хоч така версія в довіднику є');
say((await inOurs(() => consents.consentState(fx.organizationId, 'gc_lonely'))).marketing?.version === 'v1',
  'а вже дана згода на ту саму редакцію лишилась чинною — доказ не зникає');

// ── 4. Відкликання не видаляє рядка ─────────────────────────────────────────
await inOurs(() => consents.revokeConsent({
  organizationId: fx.organizationId, guestId: 'gc_lonely', consentKind: 'marketing',
}));
const revoked = await inOurs(() => consents.consentState(fx.organizationId, 'gc_lonely'));
say(revoked.marketing != null && revoked.marketing.revokedAt != null && revoked.marketing.givenAt != null,
  'відкликано — рядок ЛИШИВСЯ, і в ньому видно і коли дали, і коли відкликали');
say(!(await inOurs(() => consents.marketingAllowed(fx.organizationId, 'gc_lonely'))),
  'після відкликання листи слати не можна');

// ── 5. Похідне рахується з журналу ──────────────────────────────────────────
//
// Пара до попереднього: та сама людина знову погоджується — і дозвіл
// повертається БЕЗ жодної окремої колонки, яку хтось мусив би не забути
// оновити. Без цієї половини твердження 4 було б зелене й на коді, який
// просто ніколи нічого не дозволяє.
await inOurs(() => consents.recordConsent({
  organizationId: fx.organizationId, guestId: 'gc_lonely',
  consentKind: 'marketing', version: 'v2', source: 'reception',
}));
say(await inOurs(() => consents.marketingAllowed(fx.organizationId, 'gc_lonely')),
  'погодилась знову — дозвіл повернувся, і рахує його журнал, а не колонка');

// ── 6. Межа орендаря ────────────────────────────────────────────────────────
await guest(neighbour.organizationId, 'gc_theirs', 'Чужий', 'Гість');
let refusedTenant: unknown = null;
try {
  await inOurs(() => consents.recordConsent({
    organizationId: fx.organizationId, guestId: 'gc_theirs',
    consentKind: 'marketing', version: 'v1', source: 'reception',
  }));
} catch (e) { refusedTenant = e; }
say(isRefusal(refusedTenant),
  'згода чужому гостю — відмова, а не запис у сусідів');

// І з другого боку: сусід свого гостя бачить.
await inTheirs(() => consents.recordConsent({
  organizationId: neighbour.organizationId, guestId: 'gc_theirs',
  consentKind: 'marketing', version: 'v1', source: 'reception',
}));
say(await inTheirs(() => consents.marketingAllowed(neighbour.organizationId, 'gc_theirs')),
  'сусід записує згоду СВОЄМУ гостю — вісь є, а не «нікому не можна»');

if (process.env.DB_DRIVER !== 'postgres') fs.rmSync(tmp, { recursive: true, force: true });
assert.deepStrictEqual(fails, [], `не виконано: ${fails.join('; ')}`);
console.log('guest-consents: згода живе на особі, знає свою версію, переживає бронь і відкликається без видалення');
