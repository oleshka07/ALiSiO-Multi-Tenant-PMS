/**
 * Один документ фактури — лише для СВОГО рахунку (INC-043, друга половина).
 *
 * Три маршрути, які віддають ОДНУ фактуру: PDF, ISDOC і лист. Усі три читали
 * `invoices` тією самою формою і всі три стояли на голому `WHERE i.id = ?`.
 *
 *   node src/app/api/invoices/invoice-pdf-scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * У `GET /api/invoices/[id]/pdf` три запити, і контраст між ними — весь
 * інцидент: `loadInvoiceDocument` (німецький шлях) орендаря НАЗИВАЄ
 * (`i.organization_id = ?`), а обидва запити чеського шляху стояли на голому
 * `WHERE i.id = ?`. Один файл, одна гілка захищена, дві — ні, і саме ці дві
 * рендерять документ.
 *
 * Рід INC-014: на Postgres чуже ховає політика, на SQLite не ховає ніщо. Тобто
 * будь-хто з правом `manage_documents` діставав готову фактуру ЧУЖОЇ компанії
 * за ідентифікатором — з номером, сумою, покупцем і імʼям гостя, у файлі,
 * який виходить із системи.
 *
 * Сестра цієї вади — пакетний ZIP (`accounting/invoice-batch/zip`), знайдена
 * тим самим рухом і того ж дня.
 *
 * ── Чому сцени не було раніше ───────────────────────────────────────────
 *
 * Маршрут був недосяжний для `.check.ts`: `@invoicing` тягне
 * `domain/invoice-pdf.ts`, а той на верхньому рівні читав `__dirname`, якого в
 * модулі ESM немає. Полагоджено там же (`typeof __dirname`), і саме після цього
 * стало видно обидві діри. Місце, куди не дістає перевірка, — не біла пляма.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Вирішальна вісь тут ОРЕНДАР, тож фікстура має сусідню організацію. Твердження
 * стоять парою: свою фактуру віддає (інакше «чужу не віддає» істинне й на
 * маршруті, який не віддає нічого), чужу — 404 і жодного байта PDF. І та сама
 * чужа фактура рендериться під СВОЇМ орендарем — тобто 404 вище означає «не
 * твоя», а не «зламана».
 *
 * Номери фактур несуть слово, а не лише номер: «показав чужу» видно рядком.
 *
 * ── Чому лист перевіряється саме так ────────────────────────────────────
 *
 * `POST /api/invoices/[id]/email` — найдорожчий із трьох: він не показує
 * документ, він ВІДСИЛАЄ його на адресу, яку назвав той, хто питає (`body.to`).
 * Тобто це не читання чужого, а винесення чужого назовні.
 *
 * Сцена не шле пошти й не потребує заглушки транспорту: гість фікстури не має
 * адреси, тож своя фактура доходить до 422 «немає куди слати» — тобто ПРОЙШЛА
 * перевірку належності й спинилась пізніше. Чужа дає 404. Два різні числа на
 * двох різних шляхах — і жодного листа.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-invoice-pdf-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { invoicePdf } = await import('./[id]/pdf/route.ts');
const { invoiceIsdoc } = await import('./[id]/isdoc/route.ts');
const { invoiceEmail } = await import('./[id]/email/route.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const invoice = (id: string, organizationId: string, reservationId: string, number: string) => sql.run(
  `INSERT INTO invoices (id, organization_id, reservation_id, invoice_number, issued_at, amount, currency, status)
   VALUES (?, ?, ?, ?, ?, ?, 'EUR', 'issued')`,
  [id, organizationId, reservationId, number, '2026-09-09', 100]);

await runWithOrganization(fx.organizationId, () =>
  invoice('__pdf__mine', fx.organizationId, fx.a.reservationIds[0], 'INV-MINE-1'));

await runWithOrganization(neighbour.organizationId, async () => {
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__pdf__gn', neighbour.organizationId, 'Сусід', 'Сусідов']);
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                               check_in, check_out, nights, adults, total_price, currency)
     VALUES (?, ?, ?, ?, ?, '2026-09-21', '2026-09-22', 1, 1, 500, 'EUR')`,
    ['__pdf__rn', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0], '__pdf__gn']);
  await invoice('__pdf__theirs', neighbour.organizationId, '__pdf__rn', 'INV-NEIGHBOUR-1');
});

const render = (id: string, organizationId: string) => runWithOrganization(organizationId, async () => {
  const res = await invoicePdf(
    { url: `http://local/api/invoices/${id}/pdf` } as never,
    { params: Promise.resolve({ id }) } as never);
  const type = res.headers.get('Content-Type') || '';
  const head = type.includes('pdf')
    ? Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString('latin1')
    : (await res.text()).slice(0, 120);
  return { status: res.status, type, head };
});

// ── Своя фактура рендериться ──────────────────────────────────────────────

const mine = await render('__pdf__mine', fx.organizationId);
say(mine.status === 200 && mine.head === '%PDF',
  `своя фактура віддає PDF (статус ${mine.status}, початок «${mine.head}»)`);

// ── Чужа — 404, і жодного байта документа ─────────────────────────────────

const theirs = await render('__pdf__theirs', fx.organizationId);
say(theirs.status === 404,
  `фактура сусіднього РАХУНКУ — 404, отримали ${theirs.status}`);
say(!theirs.type.includes('pdf'),
  `і це не PDF (Content-Type «${theirs.type}»)`);
say(!theirs.head.includes('INV-NEIGHBOUR'),
  'номера чужої фактури у відповіді немає');

// ── Та сама чужа фактура під СВОЇМ орендарем: 404 означає «не твоя» ───────

const atHome = await render('__pdf__theirs', neighbour.organizationId);
say(atHome.status === 200 && atHome.head === '%PDF',
  `та сама фактура під своїм рахунком віддає PDF (статус ${atHome.status}) — тобто 404 вище про належність, а не про поломку`);

// ── ISDOC: той самий документ, той самий шов ──────────────────────────────

const isdoc = (id: string, organizationId: string) => runWithOrganization(organizationId, async () => {
  const res = await invoiceIsdoc(
    { url: `http://local/api/invoices/${id}/isdoc` } as never,
    { params: Promise.resolve({ id }) } as never);
  return { status: res.status, text: await res.text() };
});

// ISDOC зрізає дефіси з номера («ISDOC ID: strip dashes» в `isdoc.ts`), тож у
// документі номер виглядає інакше, ніж у базі. Твердження питає обидві форми —
// інакше воно перевіряло б написання, а не наявність. Знайдено прогоном: перша
// редакція шукала «INV-MINE-1» і почервоніла на цілком правильному ISDOC.
const noDashes = (n: string) => n.replaceAll('-', '');
const isdocMine = await isdoc('__pdf__mine', fx.organizationId);
say(isdocMine.status === 200
  && (isdocMine.text.includes('INV-MINE-1') || isdocMine.text.includes(noDashes('INV-MINE-1'))),
  `свій ISDOC віддається зі своїм номером (статус ${isdocMine.status})`);

const isdocTheirs = await isdoc('__pdf__theirs', fx.organizationId);
say(isdocTheirs.status === 404, `ISDOC сусіднього рахунку — 404, отримали ${isdocTheirs.status}`);
say(!isdocTheirs.text.includes('INV-NEIGHBOUR') && !isdocTheirs.text.includes(noDashes('INV-NEIGHBOUR-1')),
  'номера чужої фактури в ISDOC-відповіді немає — в жодній із двох форм');

// ── Лист: 404 ДО того, як зʼявиться адресат ───────────────────────────────

const email = (id: string, organizationId: string) => runWithOrganization(organizationId, async () => {
  const res = await invoiceEmail(
    { url: `http://local/api/invoices/${id}/email`, json: async () => ({}) } as never,
    { params: Promise.resolve({ id }) } as never);
  return { status: res.status, text: (await res.text()).slice(0, 300) };
});

const mailTheirs = await email('__pdf__theirs', fx.organizationId);
say(mailTheirs.status === 404,
  `лист із фактурою сусіднього рахунку — 404, отримали ${mailTheirs.status}`);

const mailMine = await email('__pdf__mine', fx.organizationId);
say(mailMine.status === 422,
  `своя фактура доходить до «немає куди слати» (422), отримали ${mailMine.status}`
  + ' — тобто 404 вище саме про належність, а не про те, що маршрут відмовляє завжди');

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\ninvoice-pdf-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log('invoice-pdf-scope: PDF, ISDOC і лист — лише свої; чужа фактура 404 у всіх трьох');
assert.ok(true);
