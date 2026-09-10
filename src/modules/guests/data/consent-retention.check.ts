/**
 * Знеособлений гість не має імені — але його згода лишається доказом (INC-305).
 *
 *   DB_DRIVER=postgres DATABASE_URL=… node src/modules/guests/data/consent-retention.check.ts
 *
 * ── Питання, якого ніхто не ставив ──────────────────────────────────────
 *
 * Ретенція знеособлює гостя за терміном. `guest_consents` завели пізніше, і
 * вона в її списку не значиться. Обидві очевидні відповіді неправильні:
 * видалити згоду — знищити саме той доказ, який готель показує наглядачеві;
 * лишити як є — можливо, тримати персональні дані в рядку, який мав бути
 * знеособлений.
 *
 * ── Відповідь, і вона тримається на ФОРМІ таблиці ───────────────────────
 *
 * `guest_consents` за побудовою не містить персональних даних: організація,
 * посилання на рядок, рід, версія, джерело і дві дати. Ні імені, ні пошти, ні
 * IP — на відміну від `guest_registrations`, яку ретенція саме тому й видаляє
 * (там `consent_ip`). Тому рядок лишається: після знеособлення він каже «запис
 * такий-то погодився тоді-то на редакцію таку-то» і не називає нікого.
 *
 * ── Обидва твердження в одній сцені, і третє — про підробку ─────────────
 *
 * Згоду при цьому НЕ відкликають: `revoked_at` означав би, що людина
 * відкликала згоду, а вона цього не робила. Розсилка й так неможлива — пошту
 * стерто, слати нема куди, і це перевіряється окремо.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-consent-retention-'));
if (process.env.DB_DRIVER !== 'postgres') process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const consents = await import('./guest-consents.repo.ts');
const { anonymizeOldRegistrations } = await import('./registration.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;
const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(ORG, fn);

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

await inOurs(() => sql.run(
  `INSERT INTO consent_texts (id, organization_id, consent_kind, version, locale, body)
   VALUES ('cr_ct', ?, 'marketing', 'v1', 'uk', 'Згода на розсилку')`, [ORG]));

// Гість із давнім перебуванням — саме той, кого ретенція знеособлює.
await inOurs(() => sql.run(
  `INSERT INTO guests (id, organization_id, first_name, last_name, email, phone)
   VALUES ('cr_old', ?, 'Марта', 'Давня', 'marta@example.com', '+380501112233')`, [ORG]));
await inOurs(() => sql.run(
  `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                             check_in, check_out, nights, adults, currency)
   VALUES ('cr_res', ?, ?, ?, 'cr_old', '2015-01-01', '2015-01-03', 2, 2,
           (SELECT default_currency FROM organizations WHERE id = ?))`,
  [ORG, fx.a.id, fx.a.unitIds[0], ORG]));

await inOurs(() => consents.recordConsent({
  organizationId: ORG, guestId: 'cr_old',
  consentKind: 'marketing', version: 'v1', source: 'reception',
}));

const before = await inOurs(() => consents.consentState(ORG, 'cr_old'));
say(before.marketing?.version === 'v1', 'до ретенції згода на місці (контроль)');

// Ретенція: вікно 72 місяці, перебування 2015 року давно поза ним.
await anonymizeOldRegistrations(72);

const guest = await inOurs(() => sql.row<{ first_name: string; email: string | null; phone: string | null }>(
  'SELECT first_name, email, phone FROM guests WHERE id = ?', ['cr_old']));

// ── Половина перша: людини більше не видно ──────────────────────────────────
say(guest?.first_name === 'Anonymized' && guest?.email === null && guest?.phone === null,
  `гостя знеособлено: імені, пошти й телефону немає (${guest?.first_name})`);

// ── Половина друга: доказ лишився ───────────────────────────────────────────
const after = await inOurs(() => consents.consentState(ORG, 'cr_old'));
say(after.marketing?.version === 'v1' && after.marketing?.givenAt != null,
  'згода ЛИШИЛАСЬ і памʼятає свою редакцію та дату — це те, що показують наглядачеві');

// ── Третє: згоду не підробили ───────────────────────────────────────────────
//
// Пара до попереднього. Якби ретенція «про всяк випадок» проставила
// `revoked_at`, твердження вище лишилось би зеленим (рядок же на місці), а
// запис став би стверджувати те, чого не було: людина згоди не відкликала.
say(after.marketing?.revokedAt == null,
  'і НЕ відкликана: людина цього не робила, а дописати відкликання — підробка запису');

// ── Четверте: дозвіл нікуди не веде ─────────────────────────────────────────
//
// «Згода жива» і «можна слати листи» — різні речі: слати нема куди, пошту
// стерто. Саме тому не довелося вибирати між підробкою і втратою доказу.
say(await inOurs(() => consents.marketingAllowed(ORG, 'cr_old')),
  'дозвіл формально лишається живим…');
say(guest?.email === null,
  '…але адреси немає — розсилка неможлива без жодної правки згоди');

if (process.env.DB_DRIVER !== 'postgres') fs.rmSync(tmp, { recursive: true, force: true });
assert.deepStrictEqual(fails, [], `не виконано: ${fails.join('; ')}`);
console.log('consent-retention: гостя знеособлено, згода лишилась доказом і не підроблена');
