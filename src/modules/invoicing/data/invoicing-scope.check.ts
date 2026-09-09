/**
 * Три списки фінансових документів — по обраному обʼєкту (INC-029).
 *
 *   node src/modules/invoicing/data/invoicing-scope.check.ts
 *
 * ── Що саме переведено, і чому саме ці три ──────────────────────────────
 *
 * `modules/invoicing` — 37 пар «не доведено», і майже всі це читання одного
 * рядка за первинним ключем (фоліо за `id`, підсумок за `reservation_id`):
 * вісь обʼєкта до них не застосовна за побудовою — рядок один, і його будинок
 * визначений тим, на чому запит висить. Справжніх читачів тут ТРИ:
 *
 *   `listFolios()` без броні   — увесь список рахунків готелю;
 *   `unsignedPayments()`       — непідписані касові операції, які «мусить
 *                                бачити рецепція» (німецька §6.4 п.3);
 *   `listClosings(filter)`     — закриття кас.
 *
 * Перші два не мали осі взагалі, третій мав її НЕОБОВʼЯЗКОВИМ параметром —
 * той самий шов, що в INC-037: маршрут читав `property_id` і не звіряв його,
 * тож чужий обʼєкт давав порожній список замість 404, а слово `all`, яким
 * провайдер пише «усі обʼєкти» в адресу, потрапляло б у фільтр як
 * ідентифікатор (Д49).
 *
 * Каса стоїть у будинку. Рецепція обʼєкта А, дивлячись на непідписані
 * операції обох будинків, або підписує чуже, або лишає своє непідписаним —
 * і те, і те видно лише при перевірці податковою.
 *
 * ── Пастка нульової колонки, і чому тут ІНШІ двері ──────────────────────
 *
 * `fin_folios.property_id` і `fin_folio_payments.property_id` — НУЛЬОВІ
 * (`fin_cash_closings.property_id` — `NOT NULL`, тому там звичайний фільтр).
 * `propertyScopeFilter` для нульової колонки тихо ховає рядки з NULL — рівно
 * той звір, що рядок без орендаря (інваріант 12): рядок є, його не видно, у
 * логах нічого. Тому тут `propertyOrSharedFilter`: рахунок, не привʼязаний до
 * будинку (подія, рахунок компанії), видно з КОЖНОГО обʼєкта.
 *
 * Вибір свідомий і має ціну: такий рядок зайвий в обох списках. Але
 * альтернатива — він невидимий в обох, тобто гроші, яких не бачить ніхто, і
 * це дорожче. Рішення в реєстрі.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Числа несумісні й у кожної трійки свої, щоб «переплутав список» не
 * ховалось за збігом: рахунки 3/4/6, непідписані 2/3/4, закриття 1/2/3.
 * Рядок БЕЗ обʼєкта є в фікстурі й порахований — без нього «видно з кожного»
 * було б нічим не підтверджене, а найдешевша правка (звичайний фільтр) лишила
 * б гейт зеленим.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-invoicing-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { listFolios } = await import('./folio.repo.ts');
const { unsignedPayments } = await import('./folio-payments.repo.ts');
const { listClosings } = await import('./cash-closings.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const FOLIOS_A = 2, FOLIOS_B = 3;
const UNSIGNED_A = 1, UNSIGNED_B = 2;
const CLOSINGS_A = 1, CLOSINGS_B = 2;

await runWithOrganization(fx.organizationId, async () => {
  const folio = async (id: string, propertyId: string | null) => {
    await sql.run(
      `INSERT INTO fin_folios (id, organization_id, property_id, payer_kind, currency)
       VALUES (?, ?, ?, 'guest', 'EUR')`, [id, fx.organizationId, propertyId]);
    return id;
  };
  const payment = (id: string, folioId: string, propertyId: string | null) => sql.run(
    `INSERT INTO fin_folio_payments (id, organization_id, property_id, folio_id, amount, method, paid_at, tse_status)
     VALUES (?, ?, ?, ?, ?, 'cash', ?, 'tse_failed')`,
    [id, fx.organizationId, propertyId, folioId, 10, '2026-09-09T10:00:00Z']);
  const closing = (id: string, propertyId: string, n: number) => sql.run(
    `INSERT INTO fin_cash_closings (id, organization_id, property_id, closing_date, closing_number)
     VALUES (?, ?, ?, ?, ?)`, [id, fx.organizationId, propertyId, `2026-09-0${n}`, n]);

  for (let i = 1; i <= FOLIOS_A; i++) await folio(`__inv_sc__fa${i}`, fx.a.id);
  for (let i = 1; i <= FOLIOS_B; i++) await folio(`__inv_sc__fb${i}`, fx.b.id);
  // Рахунок БЕЗ обʼєкта — подія або рахунок компанії. Він і є вісь нульової колонки.
  await folio('__inv_sc__fnull', null);

  for (let i = 1; i <= UNSIGNED_A; i++) await payment(`__inv_sc__pa${i}`, '__inv_sc__fa1', fx.a.id);
  for (let i = 1; i <= UNSIGNED_B; i++) await payment(`__inv_sc__pb${i}`, '__inv_sc__fb1', fx.b.id);
  await payment('__inv_sc__pnull', '__inv_sc__fnull', null);

  for (let i = 1; i <= CLOSINGS_A; i++) await closing(`__inv_sc__ca${i}`, fx.a.id, i);
  for (let i = 1; i <= CLOSINGS_B; i++) await closing(`__inv_sc__cb${i}`, fx.b.id, i);
});

// Очікування: рядок без обʼєкта видно з кожного (нульова колонка — «спільний»).
const EXP_FOLIOS_A = FOLIOS_A + 1, EXP_FOLIOS_B = FOLIOS_B + 1, EXP_FOLIOS_ALL = FOLIOS_A + FOLIOS_B + 1;
const EXP_UNS_A = UNSIGNED_A + 1, EXP_UNS_B = UNSIGNED_B + 1, EXP_UNS_ALL = UNSIGNED_A + UNSIGNED_B + 1;
const EXP_CLO_ALL = CLOSINGS_A + CLOSINGS_B;

say(EXP_FOLIOS_A !== EXP_FOLIOS_B && EXP_FOLIOS_ALL !== EXP_FOLIOS_A && EXP_FOLIOS_ALL !== EXP_FOLIOS_B,
  `рахунки несумісні: А=${EXP_FOLIOS_A}, Б=${EXP_FOLIOS_B}, усі=${EXP_FOLIOS_ALL}`);
say(EXP_UNS_A !== EXP_UNS_B && EXP_UNS_ALL !== EXP_UNS_A && EXP_UNS_ALL !== EXP_UNS_B,
  `непідписані несумісні: А=${EXP_UNS_A}, Б=${EXP_UNS_B}, усі=${EXP_UNS_ALL}`);
say(CLOSINGS_A !== CLOSINGS_B && EXP_CLO_ALL !== CLOSINGS_A && EXP_CLO_ALL !== CLOSINGS_B,
  `закриття несумісні: А=${CLOSINGS_A}, Б=${CLOSINGS_B}, усі=${EXP_CLO_ALL}`);

const run = <T>(f: () => Promise<T>) => runWithOrganization(fx.organizationId, f);

// ── Список рахунків ────────────────────────────────────────────────────────

const fA = await run(() => listFolios(undefined, oneProperty(fx.a.id)));
say(fA.length === EXP_FOLIOS_A, `рахунків обʼєкта А = ${EXP_FOLIOS_A}, отримали ${fA.length}`);
say(fA.some((f) => f.id === '__inv_sc__fnull'),
  'рахунок БЕЗ обʼєкта видно з обʼєкта А — інакше гроші не видно нікому');
say(!fA.some((f) => f.property_id === fx.b.id), 'рахунків обʼєкта Б у списку А немає');

const fB = await run(() => listFolios(undefined, oneProperty(fx.b.id)));
say(fB.length === EXP_FOLIOS_B, `рахунків обʼєкта Б = ${EXP_FOLIOS_B}, отримали ${fB.length}`);

const fAll = await run(() => listFolios(undefined, ALL_PROPERTIES));
say(fAll.length === EXP_FOLIOS_ALL, `сказане «усі» дає ${EXP_FOLIOS_ALL}, отримали ${fAll.length}`);

// ── Непідписані касові операції ────────────────────────────────────────────

const uA = await run(() => unsignedPayments(oneProperty(fx.a.id)));
say(uA.length === EXP_UNS_A, `непідписаних в обʼєкта А = ${EXP_UNS_A}, отримали ${uA.length}`);
const uB = await run(() => unsignedPayments(oneProperty(fx.b.id)));
say(uB.length === EXP_UNS_B, `непідписаних в обʼєкта Б = ${EXP_UNS_B}, отримали ${uB.length}`);
const uAll = await run(() => unsignedPayments(ALL_PROPERTIES));
say(uAll.length === EXP_UNS_ALL, `сказане «усі» дає ${EXP_UNS_ALL}, отримали ${uAll.length}`);

// ── Закриття кас: колонка NOT NULL, тож звичайний фільтр ───────────────────

const cA = await run(() => listClosings(oneProperty(fx.a.id)));
say(cA.length === CLOSINGS_A, `закриттів в обʼєкта А = ${CLOSINGS_A}, отримали ${cA.length}`);
const cB = await run(() => listClosings(oneProperty(fx.b.id)));
say(cB.length === CLOSINGS_B, `закриттів в обʼєкта Б = ${CLOSINGS_B}, отримали ${cB.length}`);
const cAll = await run(() => listClosings(ALL_PROPERTIES));
say(cAll.length === EXP_CLO_ALL, `сказане «усі» дає ${EXP_CLO_ALL}, отримали ${cAll.length}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\ninvoicing-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`invoicing-scope: рахунки ${EXP_FOLIOS_A}/${EXP_FOLIOS_B}/${EXP_FOLIOS_ALL}, непідписані ${EXP_UNS_A}/${EXP_UNS_B}/${EXP_UNS_ALL}, закриття ${CLOSINGS_A}/${CLOSINGS_B}/${EXP_CLO_ALL}`);
assert.ok(true);
