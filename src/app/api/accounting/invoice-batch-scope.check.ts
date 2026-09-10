/**
 * Пакет фактур у ZIP — лише СВОЇ, і лише обраного обʼєкта (INC-043, INC-029).
 *
 *   node src/app/api/accounting/invoice-batch-scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `POST /api/accounting/invoice-batch/zip` бере `invoice_ids` СПИСКОМ У ТІЛІ
 * запиту, а обидва його запити стояли на голому `WHERE i.id = ?` — без
 * `organization_id` ВЗАГАЛІ:
 *
 *     FROM invoices i LEFT JOIN reservations r … LEFT JOIN guests g …
 *      WHERE i.id = ?
 *
 * Рід INC-014: на Postgres чуже ховає політика, на SQLite не ховає ніщо — а це
 * кожна машина розробника, `npm run dev` і будь-який стенд без Postgres.
 * Фінансовий користувач одного готелю, підставивши чужі ідентифікатори,
 * діставав ZIP із фактурами ІНШОЇ КОМПАНІЇ: номери, суми, імена гостей, пошта
 * і реквізити покупців — у файлі, який виходить із системи і живе на диску рік.
 *
 * Друга вісь — обʼєкт, і тут вона не абстрактна: ідентифікатори оператор бере
 * зі списку `accounting/invoices/list`, який уже по обʼєкту (INC-029, підхід
 * шостий). Пакет, ширший за список, що його наповнює, — це та сама вада з
 * чорного ходу.
 *
 * ── Чому сцени не було раніше, і що це коштувало ────────────────────────
 *
 * Маршрут був НЕДОСЯЖНИЙ для `.check.ts`: `@invoicing` тягне
 * `domain/invoice-pdf.ts`, а той на верхньому рівні читав `__dirname`, якого в
 * модулі ESM немає — імпорт падав `ReferenceError` до першого твердження. Це
 * названо у звіті двічі (підходи 3 і 6) як прогалина, і рівно в цій прогалині
 * лежала діра без орендаря. Полагоджено в `invoice-pdf.ts` (`typeof __dirname`
 * замість голого звертання); заразом стають досяжні `accounting/isdoc-batch` і
 * `invoices/[id]/pdf`.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Осей ДВІ, бо вад дві: сусідня ОРГАНІЗАЦІЯ (2 фактури) і сусідній БУДИНОК
 * того самого рахунку (3 проти 2). Плюс фактура БЕЗ броні — вісь нульової
 * колонки: `invoices` не має `property_id`, обʼєкт приходить від броні
 * `LEFT JOIN`-ом, тож вузький фільтр викинув би такий документ із КОЖНОГО
 * пакета (Д51). Вона в фікстурі Є і порахована.
 *
 * Числа: обʼєкт А дає 3 (2 свої + спільна), «усі» — 6, сусідній рахунок — 2.
 * Жодна сума не дорівнює доданку (5, 8), тож «узяв зайве» видно числом, а імена
 * файлів несуть букву — видно ще й рядком.
 *
 * Номери фактур у сцені НАВМИСНО латиницею, і це не косметика. Пакет читається
 * як `latin1` — інакше двійкові байти ZIP псують рядок, — а кирилиця в UTF-8
 * під `latin1` не збігається НІКОЛИ. Перша редакція мала «INV-БЕЗ-БРОНІ» і
 * «INV-СУСІД»: твердження про присутність стало червоним і показало помилку, а
 * два твердження про ВІДСУТНІСТЬ були б зелені завжди — вони не могли впасти
 * за побудовою. Той самий клас, що §3.2.1: перевірка, яка не вміє почервоніти.
 *
 * Запит іде з ідентифікаторами ВСІХ трьох груп одразу: це не «не показав
 * чужого», а «попросили чуже і не дали».
 *
 * Рядка в `check-fixture-axes` ця сцена НЕ має, і це рішення, а не пропуск.
 * Дві з трьох її величин походять зі спільної фікстури (`reservationIds.length`),
 * тобто механічний лічильник РІЗНИХ ЛІТЕРАЛІВ порахував би тексти виразів, а не
 * значення, — і рядок був би зелений завжди. Реєстр уже стереже саму фікстуру
 * (2 ≠ 3), а несумісність очікуваних чисел стверджується тут першим `say`, на
 * справжніх значеннях під час прогону. Рядок, який не вміє почервоніти, гірший
 * за відсутній (§3.2), і один такий у цьому блоці вже довелося зняти.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-invoice-batch-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { invoiceBatchZip } = await import('./invoice-batch/zip/route.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const MINE_A = fx.a.reservationIds.length;   // 2
const MINE_B = fx.b.reservationIds.length;   // 3
const THEIRS = 2;

const ours: string[] = [];
const theirs: string[] = [];

const invoice = (
  id: string, organizationId: string, reservationId: string | null, number: string,
) => sql.run(
  `INSERT INTO invoices (id, organization_id, reservation_id, invoice_number, issued_at, amount, currency, status)
   VALUES (?, ?, ?, ?, ?, ?, 'EUR', 'issued')`,
  [id, organizationId, reservationId, number, '2026-09-09', 100]);

await runWithOrganization(fx.organizationId, async () => {
  let n = 0;
  for (const [side, ids] of [['A', fx.a.reservationIds], ['B', fx.b.reservationIds]] as const) {
    for (const reservationId of ids) {
      n += 1;
      const id = `__batch__${side}${n}`;
      ours.push(id);
      await invoice(id, fx.organizationId, reservationId, `INV-${side}-${n}`);
    }
  }
  // Фактура БЕЗ броні — обʼєкта не має, і мусить лишатись у КОЖНОМУ пакеті.
  ours.push('__batch__shared');
  await invoice('__batch__shared', fx.organizationId, null, 'INV-NO-BOOKING');
});

await runWithOrganization(neighbour.organizationId, async () => {
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__batch__gn', neighbour.organizationId, 'Сусід', 'Сусідов']);
  for (let i = 1; i <= THEIRS; i++) {
    const reservationId = `__batch__rn${i}`;
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                                 check_in, check_out, nights, adults, total_price, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 500, 'EUR')`,
      [reservationId, neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0],
        '__batch__gn', `2026-09-2${i}`, `2026-09-2${i + 1}`]);
    const id = `__batch__N${i}`;
    theirs.push(id);
    await invoice(id, neighbour.organizationId, reservationId, `INV-NEIGHBOUR-${i}`);
  }
});

const EXPECT_A = MINE_A + 1;                 // 3 — свої плюс фактура без броні
const EXPECT_ALL = MINE_A + MINE_B + 1;      // 6
say(EXPECT_A !== EXPECT_ALL && EXPECT_A !== THEIRS && EXPECT_ALL !== THEIRS
  && EXPECT_A + THEIRS !== EXPECT_ALL,
  `числа несумісні: обʼєкт А ${EXPECT_A}, усі ${EXPECT_ALL}, сусідній рахунок ${THEIRS}`);

/** Пакет STORE — імена й вміст лежать у буфері як є, тож їх видно текстом. */
const zip = async (ids: string[], scope: string) => runWithOrganization(fx.organizationId, async () => {
  const url = `http://local/api/accounting/invoice-batch/zip?property_id=${scope}`;
  const res = await invoiceBatchZip({
    url, nextUrl: new URL(url), json: async () => ({ invoice_ids: ids, format: 'isdoc', channel: 'test' }),
  } as never);
  if (res.status !== 200) return { status: res.status, files: 0, text: await res.text() };
  const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
  return { status: res.status, files: Number(res.headers.get('X-Files-Count')), text };
});

const everything = [...ours, ...theirs];

// ── Обʼєкт А: свої плюс фактура без броні, і нічого більше ─────────────────

const a = await zip(everything, fx.a.id);
say(a.files === EXPECT_A, `пакет обʼєкта А — ${EXPECT_A} файлів, отримали ${a.files}`);
say(!a.text.includes('INV-B-'), 'фактур сусіднього будинку в пакеті обʼєкта А немає');
say(!a.text.includes('INV-NEIGHBOUR'), 'фактур сусіднього РАХУНКУ в пакеті обʼєкта А немає');
say(a.text.includes('INV-NO-BOOKING'),
  'фактура БЕЗ броні лишається в пакеті обʼєкта — інакше її не отримає ніхто');

// ── Сказане «усі обʼєкти» — обидва будинки, але той самий рахунок ──────────

const all = await zip(everything, 'all');
say(all.files === EXPECT_ALL, `сказане «усі обʼєкти» — ${EXPECT_ALL} файлів, отримали ${all.files}`);
say(!all.text.includes('INV-NEIGHBOUR'),
  'і навіть «усі обʼєкти» не дістає чужого рахунку — це інша вісь');

// ── Самі лише чужі ідентифікатори: жодного файла ───────────────────────────
//
// Без цього «чужого немає» було б істинне й тоді, коли пакет мовчки бере перші
// N: тут просять РІВНО чуже, і відповідь мусить бути відмовою, а не архівом.

const alien = await zip(theirs, 'all');
say(alien.status === 400 && alien.files === 0,
  `самі чужі ідентифікатори — 400 і жодного файла (статус ${alien.status}, файлів ${alien.files})`);
say(!alien.text.includes('INV-NEIGHBOUR'),
  'і у відповіді на відмову немає номерів чужих фактур');

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\ninvoice-batch-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`invoice-batch-scope: обʼєкт А ${EXPECT_A}, усі ${EXPECT_ALL}, чужий рахунок — 400`);
assert.ok(true);
