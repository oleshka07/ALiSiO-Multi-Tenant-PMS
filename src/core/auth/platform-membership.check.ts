/**
 * Готельєр входить лише у СВОЇ рахунки, і всередині лишається собою (П21).
 *
 *   node src/core/auth/platform-membership.check.ts
 *
 * ── Що ламається ────────────────────────────────────────────────────────
 *
 * Платформна сесія вміє входити рівно в один рахунок і поза ним відмовляє як
 * чужому — машинерія побудована й перевірена. Але `enterOrganization`
 * перевіряла ЛИШЕ що організація існує, а `platformOrganizations` віддавала
 * список УСІХ організацій сервера. Доти це було безпечно рівно тому, що
 * платформний вхід мали тільки ми: постачальникові й треба входити в кожен
 * рахунок, який він обслуговує.
 *
 * П21 віддає той самий вхід ГОТЕЛЬЄРУ — і без переліку «в які рахунки ця
 * людина може входити» це означає доступ до всіх готелів на сервері. Не
 * «колись доведеться додати»: перелік — це те, з чого задача починається.
 *
 * ── Дві межі, і третя, яку легко проґавити ──────────────────────────────
 *
 * 1. Вхід поза переліком — відмова, і 404, а не 403: чужий рахунок для цієї
 *    людини не існує (інваріант 5).
 * 2. Список показує лише свої. Перелік чужих готелів — це вже витік, навіть
 *    коли увійти в них не можна.
 * 3. **Готельєр не стає постачальником.** Усередині рахунку він мусить бути
 *    СОБОЮ: своє імʼя в аудиті, своя роль, свої права. Синтетичний
 *    «Підтримка ALiSiO» з усіма правами — це те, що бачить рахунок у своєму
 *    журналі змін, і власник готелю не має там так називатись; а
 *    `ALL_PERMISSIONS` зробили б адміністратора рецепції власником.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * * ТРИ організації, членство в ОДНІЙ: з двома «показує своє» не відрізнити
 *   від «показує все, крім останнього», а з однією — від «показує все»;
 * * ДВА роди платформного користувача: без постачальника поруч «готельєру
 *   відмовлено» істинне й на коді, який відмовляє геть усім;
 * * роль готельєра — `manager`, НЕ `owner`: інакше «діє собою» зелене й на
 *   коді, який і далі підставляє синтетичного власника.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-membership-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const platform = await import('./platform.ts');

const sql = getSql();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// ── Фікстура: три рахунки, дві людини ────────────────────────────────────
//
// Прибирання ПЕРЕД засівом, а не після: у `check:pg` усі сцени бігають в
// ОДНІЙ базі, і сцена, яка лишає по собі рядки, падає при другому прогоні на
// `organizations_pkey` — тобто червоніє не про те, що стверджує. Знайдено
// власним прогоном на стенді (INC-101), і це той самий клас, який я минулого
// разу назвала про спільну фікстуру.
const CLEAN: Array<[string, string]> = [
  ['platform_memberships', "platform_user_id IN (SELECT id FROM platform_users WHERE email IN ('support@alisio.test','owner@hotel-a.test'))"],
  ['platform_sessions', "platform_user_id IN (SELECT id FROM platform_users WHERE email IN ('support@alisio.test','owner@hotel-a.test'))"],
  ['platform_audit', "organization_id LIKE '__pm\\_%' ESCAPE '\\'"],
  ['platform_users', "email IN ('support@alisio.test','owner@hotel-a.test')"],
  ['app_users', "id = '__pm_au_a'"],
  ['organizations', "id LIKE '__pm\\_%' ESCAPE '\\'"],
];
for (const [table, where] of CLEAN) {
  await sql.run(`DELETE FROM ${table} WHERE ${where}`, []).catch(() => undefined);
}

const ORGS = [
  ['__pm_a', 'Hotel A', 'pm-a'],
  ['__pm_b', 'Hotel B', 'pm-b'],
  ['__pm_c', 'Hotel C', 'pm-c'],
] as const;

for (const [id, name, slug] of ORGS) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [id, name, slug]);
}

// Готельєр — менеджер у рахунку А. Роль НЕ власницька навмисно: саме на ній
// видно, підставляє код синтетичного власника чи справжню людину.
const HOTELIER_APP_USER = '__pm_au_a';
await runWithOrganization('__pm_a', async () => {
  await sql.run(
    `INSERT INTO app_users (id, organization_id, email, full_name, role, is_active)
     VALUES (?, ?, ?, ?, 'manager', TRUE)`,
    [HOTELIER_APP_USER, '__pm_a', 'owner@hotel-a.test', 'Марта Ковальська']);
});

const supplierId = crypto.randomUUID();
const hotelierId = crypto.randomUUID();
await sql.run(
  `INSERT INTO platform_users (id, email, full_name, password_hash, kind)
   VALUES (?, ?, ?, ?, 'supplier')`,
  [supplierId, 'support@alisio.test', 'ALiSiO', platform.hashPlatformPassword('x-supplier-x')]);
await sql.run(
  `INSERT INTO platform_users (id, email, full_name, password_hash, kind)
   VALUES (?, ?, ?, ?, 'hotelier')`,
  [hotelierId, 'owner@hotel-a.test', 'Марта Ковальська', platform.hashPlatformPassword('x-hotelier-x')]);

// Членство — рівно в А, і воно НАЗИВАЄ, ким людина є в тому рахунку.
//
// Засів іде В КОНТЕКСТІ рахунку навмисно, хоч справжній писач
// (`scripts/platform-user.mjs --grant`) пише поза ним. Причина методична: сцена
// стверджує про ЧИТАННЯ, і щоб довести червоність поверненням тенантної
// політики (INC-101), решта має лишитись сталою. Із засівом поза контекстом
// політика валила б фікстуру на `WITH CHECK` — червоне було б, але не про те.
await runWithOrganization('__pm_a', () => sql.run(
  `INSERT INTO platform_memberships (id, platform_user_id, organization_id, app_user_id)
   VALUES (?, ?, ?, ?)`,
  [crypto.randomUUID(), hotelierId, '__pm_a', HOTELIER_APP_USER]));

const sessionOf = async (userId: string) =>
  (await platform.getPlatformSession(await platform.createPlatformSession(userId)))!;

// ── 1. Вхід поза переліком — відмова ─────────────────────────────────────

const hotelier = await sessionOf(hotelierId);
const intoOwn = await platform.enterOrganization(hotelier, '__pm_a', null);
say(intoOwn === true, `у СВІЙ рахунок готельєр входить (контроль), отримали ${intoOwn}`);

const fresh = await sessionOf(hotelierId);
const intoForeign = await platform.enterOrganization(fresh, '__pm_b', null);
say(intoForeign === false, `у ЧУЖИЙ рахунок — відмова, отримали ${intoForeign}`);

// Відмова не лишає по собі половини: ні сесії всередині, ні рядка в аудиті
// чужого рахунку. Напіввідмовлений вхід виглядав би як вхід.
const after = await platform.getPlatformSession(fresh.sessionId);
say(after?.actingOrganizationId == null,
  `після відмови сесія лишається зовні, отримали ${JSON.stringify(after?.actingOrganizationId)}`);
const trace = await runWithOrganization('__pm_b', () =>
  sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM platform_audit WHERE organization_id = ?', ['__pm_b']));
say(Number(trace?.n ?? -1) === 0,
  `і жодного сліду в журналі чужого рахунку, отримали ${trace?.n}`);

// ── 2. Список показує лише свої — і ЩЕ НІКУДИ НЕ УВІЙШОВШИ ───────────────
//
// Стан, у якому цей список і малюється: людина зайшла в платформу, рахунок ще
// не обрано. На Postgres саме тут ламалося (INC-101): `platform_memberships`
// має `organization_id`, тож генератор дав їй тенантну політику механічно —
// а орендаря на зʼєднанні ще немає, пул пише порожній рядок, і строгий
// предикат не збігав НІЧОГО. Не виняток, а порожній список: готельєр бачив
// «жодного готелю не призначено» при заведеному членстві, і вхід у власний
// готель віддавав 404. Клас INC-014: функція зникла, а не впала.
//
// Тому твердження про порожню сесію окреме, а не «десь по дорозі»: на SQLite
// політик немає, і воно зелене там завжди. Червоніє воно лише в `check:pg`.
const outside = await sessionOf(hotelierId);
say(outside.actingOrganizationId === null,
  `сесія ще нікуди не входила (контроль), отримали ${JSON.stringify(outside.actingOrganizationId)}`);
const listedOutside = await platform.accountsFor(outside);
say(listedOutside.length === 1 && listedOutside[0]?.id === '__pm_a',
  `і вже бачить свій рахунок: ${listedOutside.length} рядків ${JSON.stringify(listedOutside.map((o) => o.id))}`);

const mine = await platform.accountsFor(hotelier);
say(mine.length === 1, `готельєр бачить ОДИН рахунок із трьох, отримали ${mine.length}`);
say(mine[0]?.id === '__pm_a', `і саме свій, отримали ${mine[0]?.id}`);

// ── 3. Постачальник — інший рід, і без нього пункт 1 нічого не стверджує ──

const supplier = await sessionOf(supplierId);
const supplierIn = await platform.enterOrganization(supplier, '__pm_b', null);
say(supplierIn === true, `постачальник входить у будь-який рахунок (це його робота), отримали ${supplierIn}`);
// Рахується ВКЛЮЧЕННЯ трьох моїх, а не рівність числу: у свіжій базі є ще
// демо-організація засіву, і твердження, привʼязане до її наявності, ламалося б
// від чужої зміни в засіві — тобто червоніло б не про те.
const supplierSees = await platform.accountsFor(supplier);
const supplierIds = new Set(supplierSees.map((o) => o.id));
say(ORGS.every(([id]) => supplierIds.has(id)),
  `і бачить усі три мої рахунки серед ${supplierSees.length}`);
say(supplierSees.length > mine.length,
  `перелік постачальника ширший за перелік готельєра: ${supplierSees.length} проти ${mine.length}`);

// ── 4. Усередині рахунку готельєр лишається СОБОЮ ────────────────────────

const acting = await platform.actingUserFor(hotelier, '__pm_a');
say(acting.full_name === 'Марта Ковальська',
  `в аудиті рахунку стоїть імʼя людини, а не «Підтримка», отримали «${acting.full_name}»`);
say(acting.role === 'manager', `роль — своя, не власницька, отримали «${acting.role}»`);
say(acting.id === HOTELIER_APP_USER,
  `і це саме рядок цієї людини в цьому рахунку, отримали «${acting.id}»`);

// Постачальник — навпаки: синтетичний власник із повними правами, бо його
// робота це лагодити те, чого клієнт полагодити не може.
const supportActing = await platform.actingUserFor(supplier, '__pm_b');
say(supportActing.role === 'owner' && String(supportActing.full_name).includes('ALiSiO'),
  `постачальник усередині лишається підтримкою з повними правами, отримали «${supportActing.full_name}»`);
say(acting.permissions.length < supportActing.permissions.length,
  `прав у готельєра МЕНШЕ, ніж у постачальника: ${acting.permissions.length} проти ${supportActing.permissions.length}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nplatform-membership: ${fails.length} червоних`);
  process.exit(1);
}
console.log('platform-membership: готельєр входить лише у свої рахунки і лишається в них собою');
assert.ok(true);
