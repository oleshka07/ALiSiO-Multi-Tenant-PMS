/**
 * Книга гостей і сума збору — по ОДНОМУ обʼєкту, бо подають їх по закладу (INC-037).
 *
 *   node src/modules/guests/data/registry-scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * Підсумок реєстру рахує так:
 *
 *   SUM(CASE WHEN COALESCE(rg.fee_exempt, FALSE) = TRUE THEN 0
 *            ELSE r.nights * p.city_tax_per_night END) AS totalFees
 *
 * `city_tax_per_night` — ставка ОБʼЄКТА. Без осі сума множить ночі кожного
 * обʼєкта на ЙОГО власну ставку і додає різні обʼєкти в одну цифру. Це не
 * «широко»: evidenční kniha і звіт про збір подаються ПО ЗАКЛАДУ, тобто така
 * цифра неправильна за побудовою, а не за обставинами.
 *
 * Вісь у репозиторії була й раніше — і була МЕРТВА: екран
 * (`guest-registry/page.tsx`) не ставив параметра ніколи. А обставина, через
 * яку «очевидна» правка була б порожньою: маршрут читав
 * `searchParams.get('propertyId')`, тоді як провайдер області і решта екранів
 * шлють `property_id` (NAMING §8). Переведений «як усі» екран відправив би
 * `property_id`, маршрут прочитав би `undefined`, і не змінилось би нічого —
 * а правка виглядала б зробленою. Тому маршрут іде через `requestPropertyScope`,
 * а репозиторій приймає `PropertyScope`, де «усі» — СКАЗАНЕ значення.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Спільна фікстура: обʼєкт А — ставка 20, дві броні по одній ночі; обʼєкт Б —
 * ставка 35, три броні по одній ночі. По одному зареєстрованому гостю на бронь:
 *
 *   А = 2 × 1 × 20 = 40      Б = 3 × 1 × 35 = 105      «усі» = 145
 *
 * Три числа несумісні: 145 не дорівнює ні 40, ні 105, ні подвоєному жодному з
 * них, і «взяв ставку сусіда» дало б 70 або 60 — теж ні на що не схоже. З
 * однаковими ставками твердження було б зелене й на зламаному коді.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-registry-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const registry = await import('./registry.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// По одному зареєстрованому гостю на кожну бронь фікстури.
await runWithOrganization(fx.organizationId, async () => {
  let n = 0;
  for (const [side, ids] of [['A', fx.a.reservationIds], ['B', fx.b.reservationIds]] as const) {
    for (const reservationId of ids) {
      n += 1;
      await sql.run(
        `INSERT INTO reservation_guests (id, reservation_id, first_name, last_name, nationality)
         VALUES (?, ?, ?, ?, ?)`,
        [`__reg_scope__${n}`, reservationId, `Гість${n}`, `Обʼєкт${side}`, 'CZ']);
    }
  }
});

// Місяць — У ФІКСТУРИ: книга рахує саме її броні, тож літерал тут означав
// «шукати там, де фікстура сіє СЬОГОДНІ», і завтра означав би інше.
const MONTH = fx.month;
const FEES_A = fx.a.reservationIds.length * fx.a.cityTaxPerNight;   // 2 × 20 = 40
const FEES_B = fx.b.reservationIds.length * fx.b.cityTaxPerNight;   // 3 × 35 = 105
const FEES_ALL = FEES_A + FEES_B;                                    // 145

say(FEES_A !== FEES_B && FEES_ALL !== FEES_A && FEES_ALL !== FEES_B,
  `три очікувані суми різні і несумісні: А=${FEES_A}, Б=${FEES_B}, усі=${FEES_ALL}`);

const summary = (scope: unknown) => runWithOrganization(fx.organizationId, () =>
  registry.getRegistrySummary(fx.organizationId, { month: MONTH, scope: scope as never }));
const entries = (scope: unknown) => runWithOrganization(fx.organizationId, () =>
  registry.getRegistryEntries(fx.organizationId, { month: MONTH, scope: scope as never }));

// ── Сума, яку подають, — сума ОДНОГО обʼєкта ───────────────────────────────

const a = await summary(oneProperty(fx.a.id));
say(Number(a.totalFees) === FEES_A,
  `збір обʼєкта А = ${FEES_A}, отримали ${a.totalFees}`);
say(Number(a.totalGuests) === fx.a.reservationIds.length,
  `гостей у книзі обʼєкта А = ${fx.a.reservationIds.length}, отримали ${a.totalGuests}`);

const b = await summary(oneProperty(fx.b.id));
say(Number(b.totalFees) === FEES_B,
  `збір обʼєкта Б = ${FEES_B}, отримали ${b.totalFees}`);

// ── «Усі обʼєкти» лишається можливим — але СКАЗАНИМ ───────────────────────
//
// Без цієї сцени правку можна було б виконати, просто зробивши обʼєкт
// обовʼязковим, — і зведений перегляд зник би разом із вадою.

const all = await summary(ALL_PROPERTIES);
say(Number(all.totalFees) === FEES_ALL,
  `сказане «усі обʼєкти» дає ${FEES_ALL}, отримали ${all.totalFees}`);

// ── Список так само ────────────────────────────────────────────────────────

const listA = await entries(oneProperty(fx.a.id));
say(listA.length === fx.a.reservationIds.length,
  `у книзі обʼєкта А ${fx.a.reservationIds.length} записи, знайшли ${listA.length}`);
say(listA.every((e) => Number(e.fee_amount) === fx.a.cityTaxPerNight),
  `кожен рядок книги А порахований за ставкою А (${fx.a.cityTaxPerNight})`);

const listAll = await entries(ALL_PROPERTIES);
say(listAll.length === fx.totalReservations,
  `у зведеній книзі ${fx.totalReservations} записів, знайшли ${listAll.length}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nregistry-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`registry-scope: збір рахується по обʼєкту (${FEES_A} і ${FEES_B}), а «усі» (${FEES_ALL}) лишається сказаним значенням`);
assert.ok(true);
