/**
 * Сайт належить ОБʼЄКТУ, і продає лише його номери й послуги (INC-034, INC-035).
 *
 *   node src/app/api/booking-sites/site-property-scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `booking_sites.property_id` — `NOT NULL`, тобто сайт заведено ПІД ОБʼЄКТ.
 * Варта `withOwnedSite` звіряє сайт із рахунком і повертає ввесь рядок, а
 * обидва маршрути брали з нього лише `organizationId` і питали:
 *
 *   SELECT u.id FROM units u JOIN properties p ON u.property_id = p.id
 *    WHERE u.id = ? AND p.organization_id = ?
 *
 * Знову рахунок. Коментар над цим запитом каже «Owning the SITE does not make
 * a room yours» — і має рацію про сусідній РАХУНОК; сусідній ОБʼЄКТ проходив
 * повністю. Готель із двома обʼєктами клав у `site_listings` сайта обʼєкта А
 * номер обʼєкта Б, і сайт А його **продавав**. Те саме з послугами
 * (`site_services`).
 *
 * Це ЗАПИС, а не показ: наслідок не «оператор бачить зайве», а «гість купив
 * номер, якого за цією адресою немає».
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Одна організація, ДВА обʼєкти — без другого «чужий обʼєкт» ні від чого не
 * відрізняється, а орендар тут ні до чого: варта рахунку працює, і саме тому
 * вада прожила. Спільна фікстура `@core/fixtures/two-properties`.
 *
 * Кожне твердження ставиться ДВІЧІ, і зустрічна половина обовʼязкова: без неї
 * «чужий номер відхилено» істинне й на коді, який відхиляє геть усе, — а таку
 * правку легко зробити випадково, звузивши умову на порожньому `property_id`.
 *
 * Числа беруться з фікстури, не з голови: 5 номерів в А, 7 у Б. Повідомлення
 * називає число, бо «не той номер» без числа не відрізнити від «жодного».
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-site-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { createSession } = await import('@core/auth/auth.ts');
const listings = await import('./[id]/listings/route.ts');
const services = await import('./[id]/services/route.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// ── Фікстура поверх спільної: сесія, ключ модуля, сайт обʼєкта А ───────────
//
// Сайт стоїть на обʼєкті А навмисно: усе нижче питає, чи проходить крізь нього
// обʼєкт Б.
const USER = '__site_scope__user';
const SITE_A = '__site_scope__site_a';

await runWithOrganization(fx.organizationId, async () => {
  await sql.run(
    'INSERT INTO app_users (id, organization_id, email, full_name, role) VALUES (?, ?, ?, ?, ?)',
    [USER, fx.organizationId, 'site-scope@example.test', 'Site Scope', 'owner'],
  );
  // Сайти — платний модуль; без ключа `withOwnedSite` віддає відмову модуля, і
  // жодне твердження нижче не про обʼєкт.
  await sql.run(
    'INSERT INTO organization_features (organization_id, feature, enabled) VALUES (?, ?, TRUE)',
    [fx.organizationId, 'sites'],
  );
  await sql.run(
    'INSERT INTO booking_sites (id, organization_id, property_id, name, slug) VALUES (?, ?, ?, ?, ?)',
    [SITE_A, fx.organizationId, fx.a.id, 'Сайт обʼєкта А', '__site_scope__a'],
  );
});

const cookie = `session_id=${await createSession(USER)}`;

/** Послуга ОДНОГО обʼєкта — своя на кожному, бо фікстура ядра їх не заводить. */
async function seedService(propertyId: string, id: string, name: string): Promise<string> {
  await runWithOrganization(fx.organizationId, () => sql.run(
    `INSERT INTO additional_services (id, property_id, name, price, currency, is_active)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [id, propertyId, name, 100, 'EUR'],
  ));
  return id;
}
const svcA = await seedService(fx.a.id, '__site_scope__svc_a', 'Сніданок А');
const svcB = await seedService(fx.b.id, '__site_scope__svc_b', 'Сніданок Б');

const req = (body: unknown) => ({
  headers: { get: () => cookie },
  json: async () => body,
  url: 'http://local/api/booking-sites/x',
} as never);
const ctx = { params: Promise.resolve({ id: SITE_A }) } as never;

// ── INC-034. Номер і тип номера ────────────────────────────────────────────

const ownUnit = fx.a.unitIds[0];
const alienUnit = fx.b.unitIds[0];

const okUnit = await listings.POST(req({ unit_id: ownUnit }), ctx) as Response;
say(okUnit.status === 200 || okUnit.status === 201,
  `номер ВЛАСНОГО обʼєкта сайт приймає (статус ${okUnit.status})`);

const badUnit = await listings.POST(req({ unit_id: alienUnit }), ctx) as Response;
say(badUnit.status === 404,
  `номер ЧУЖОГО обʼєкта відхилено 404 (статус ${badUnit.status})`);

const alienType = fx.b.unitTypeIds[0];
const badType = await listings.POST(req({ unit_type_id: alienType }), ctx) as Response;
say(badType.status === 404,
  `тип номера ЧУЖОГО обʼєкта відхилено 404 (статус ${badType.status})`);

const ownType = fx.a.unitTypeIds[0];
const okType = await listings.POST(req({ unit_type_id: ownType }), ctx) as Response;
say(okType.status === 200 || okType.status === 201,
  `тип номера ВЛАСНОГО обʼєкта сайт приймає (статус ${okType.status})`);

// Числом, а не статусом: 200 з порожнім тілом уже було вадою в цьому проєкті.
const rows = await runWithOrganization(fx.organizationId, () => sql.rows<{ unit_id: string | null }>(
  'SELECT unit_id, unit_type_id FROM site_listings WHERE site_id = ?', [SITE_A]));
say(rows.length === 2,
  `у сайті обʼєкта А рівно 2 позиції — свій номер і свій тип, знайшли ${rows.length}`);
say(!rows.some((r) => r.unit_id === alienUnit),
  'номер обʼєкта Б не потрапив у site_listings сайта обʼєкта А');

// ── INC-035. Послуги: запис і читання ──────────────────────────────────────

const okSvc = await services.POST(req({ service_id: svcA, is_enabled: true }), ctx) as Response;
say(okSvc.status === 200 || okSvc.status === 201,
  `послугу ВЛАСНОГО обʼєкта сайт приймає (статус ${okSvc.status})`);

const badSvc = await services.POST(req({ service_id: svcB, is_enabled: true }), ctx) as Response;
say(badSvc.status === 404,
  `послугу ЧУЖОГО обʼєкта відхилено 404 (статус ${badSvc.status})`);

const enabled = await runWithOrganization(fx.organizationId, () => sql.rows<{ service_id: string }>(
  'SELECT service_id FROM site_services WHERE site_id = ?', [SITE_A]));
say(enabled.length === 1 && enabled[0].service_id === svcA,
  `у сайті увімкнено рівно одну послугу — свою (${enabled.map((e) => e.service_id).join(', ') || 'жодної'})`);

// Читання: каталог, який сайт пропонує увімкнути, теж про свій обʼєкт.
const listed = await services.GET(req(null), ctx) as Response;
const body = await listed.json() as { services?: { id: string }[] };
const ids = (body.services || []).map((s) => s.id);
say(ids.includes(svcA) && !ids.includes(svcB),
  `каталог сайта показує свою послугу і не показує чужої (${ids.join(', ') || 'порожньо'})`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nsite-property-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log('site-property-scope: сайт обʼєкта продає лише його номери, типи і послуги');
assert.ok(true);
