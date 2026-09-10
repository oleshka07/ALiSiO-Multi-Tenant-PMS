/**
 * Правило каналу береться з БУДИНКУ цієї броні, а не з першого рядка (INC-029).
 *
 *   node src/modules/invoicing/data/stay-charges.rule-scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `postStayCharges` читав `channel_rate_rules WHERE organization_id = ?` — усі
 * правила РАХУНКУ — і віддавав їх `ruleFor`, який брав перший збіг за каналом.
 * `channel_rate_rules.property_id` при цьому нульовий, а UNIQUE на «рахунок ×
 * канал» немає: два будинки одного готелю можуть мати кожен своє правило для
 * `booking.com`. Тобто вибір робив ПОРЯДОК РЯДКІВ — той самий звір, що INC-027,
 * і на SQLite та Postgres він різний.
 *
 * Ціна помилки не в списку на екрані. Правило вирішує, чи ділити суму на
 * проживання й сніданок, за якими цінами — і якими ПОДАТКОВИМИ КОДАМИ. Чуже
 * правило ставить у рахунок ставку іншої домовленості, а на двох юрисдикціях —
 * іншої країни (інваріант 22). Рахунок із номером у книзі, який потім треба
 * сторнувати.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Три правила на той самий канал: будинку А, будинку Б і спільне на рахунок.
 * Ціни сніданку 15 / 50 / 6 за особу — жодна пара не дає третьої, тож «узяв не
 * те» видно сумою проживання (170 / 100 / 188 з двохсот на двох гостей). Плюс
 * податковий код: у Б він `standard`, тож чужий вибір видно ще й ставкою 19 %
 * замість 7 %.
 *
 * Правило будинку Б засіяне ПЕРШИМ — саме тому, що до правки вибір робив
 * порядок: сцена мусить ловити ту поведінку, яка була, а не ту, яку зручно.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-rule-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { postStayCharges } = await import('./stay-charges.repo.ts');
const { createFolio } = await import('./folio.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const TOTAL = 200;
// Сніданок — ЗА ОСОБУ, і це знайшов перший прогін: я чекала 185, отримала 170.
// Число фікстури мусить бути тим, що дає код, а не тим, що зручно порахувати в
// голові, — інакше «зелене» означало б «я підігнала очікування».
const PERSONS = 2;
const A_FOOD = 12, A_DRINKS = 3;     // 15 × 2 = 30
const B_FOOD = 40, B_DRINKS = 10;    // 50 × 2 = 100
const ORG_FOOD = 5, ORG_DRINKS = 1;  // 6 × 2 = 12

const LODGING_A = TOTAL - PERSONS * (A_FOOD + A_DRINKS);       // 170
const LODGING_B = TOTAL - PERSONS * (B_FOOD + B_DRINKS);       // 100
const LODGING_ORG = TOTAL - PERSONS * (ORG_FOOD + ORG_DRINKS); // 188

say(new Set([LODGING_A, LODGING_B, LODGING_ORG]).size === 3,
  `суми проживання несумісні: свій ${LODGING_A}, сусідній будинок ${LODGING_B}, спільне ${LODGING_ORG}`);

await runWithOrganization(fx.organizationId, async () => {
  for (const [code, rate] of [['reduced', 7], ['standard', 19]] as const) {
    await sql.run(
      'INSERT INTO fin_tax_rates (id, organization_id, code, rate, valid_from) VALUES (?, ?, ?, ?, ?)',
      [`__rs__${code}`, fx.organizationId, code, rate, '2020-01-01']);
  }

  const rule = (
    id: string, propertyId: string | null, food: number, drinks: number, lodgingCode: string,
  ) => sql.run(
    `INSERT INTO channel_rate_rules
       (id, organization_id, property_id, channel, includes_breakfast,
        breakfast_food_price, breakfast_drinks_price,
        lodging_tax_code, food_tax_code, drinks_tax_code, markup_percent)
     VALUES (?, ?, ?, 'booking', TRUE, ?, ?, ?, 'reduced', 'standard', 0)`,
    [id, fx.organizationId, propertyId, food, drinks, lodgingCode]);

  // Сусідній будинок ПЕРШИМ — до правки вибір робив саме порядок.
  await rule('__rs__b', fx.b.id, B_FOOD, B_DRINKS, 'standard');
  await rule('__rs__org', null, ORG_FOOD, ORG_DRINKS, 'reduced');
  await rule('__rs__a', fx.a.id, A_FOOD, A_DRINKS, 'reduced');
});

const post = async (id: string, propertyId: string, unitId: string) =>
  runWithOrganization(fx.organizationId, async () => {
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                                 check_in, check_out, nights, adults, total_price, currency,
                                 status, source)
       VALUES (?, ?, ?, ?, ?, '2026-10-10', '2026-10-11', 1, 2, ?, 'EUR', 'confirmed', 'booking')`,
      [id, fx.organizationId, propertyId, unitId, '__two_props__guest', TOTAL]);
    const folioId = await createFolio({ reservationId: id, payerKind: 'guest' });
    const result = await postStayCharges({ reservationId: id, folioId }) as
      { lines?: { kind: string; totalGross: number; vatRate: number }[]; reason?: string };
    return result;
  });

// ── Бронь будинку А бере правило будинку А ────────────────────────────────

const a = await post('__rs__res_a', fx.a.id, fx.a.unitIds[0]);
const lodgingA = (a.lines || []).find((l) => l.kind === 'lodging');
say(!a.reason, `нарахування пройшло (${a.reason ?? 'без відмови'})`);
say(lodgingA?.totalGross === LODGING_A,
  `проживання = ${LODGING_A} (${TOTAL} − ${PERSONS} × (${A_FOOD} + ${A_DRINKS})), отримали ${lodgingA?.totalGross}`);
say(lodgingA?.vatRate === 7,
  `ставка проживання 7 % за правилом свого будинку, отримали ${lodgingA?.vatRate} %`);
say((a.lines || []).some((l) => l.kind === 'breakfast_food' && l.totalGross === PERSONS * A_FOOD),
  `їжа сніданку = ${PERSONS * A_FOOD} свого будинку (${A_FOOD} × ${PERSONS}), а не ${PERSONS * B_FOOD} сусідського`);

// ── Зустрічна вісь: бронь будинку Б бере правило будинку Б ────────────────
//
// Без неї «взяв правило А» істинне й на коді, який завжди бере перше правило
// зі списку — воно ж могло виявитись правилом А випадково.

const b = await post('__rs__res_b', fx.b.id, fx.b.unitIds[0]);
const lodgingB = (b.lines || []).find((l) => l.kind === 'lodging');
say(lodgingB?.totalGross === LODGING_B,
  `проживання броні будинку Б = ${LODGING_B}, отримали ${lodgingB?.totalGross}`);
say(lodgingB?.vatRate === 19,
  `і ставка ЙОГО правила — 19 %, отримали ${lodgingB?.vatRate} % (податковий код теж належить будинку)`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nstay-charges.rule-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`stay-charges.rule-scope: А → ${LODGING_A} під 7 %, Б → ${LODGING_B} під 19 %`);
assert.ok(true);
