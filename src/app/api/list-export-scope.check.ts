/**
 * Списки і ВИВАНТАЖЕННЯ маршрутів `app/api` — по обраному обʼєкту (INC-029).
 *
 *   node src/app/api/list-export-scope.check.ts
 *
 * ── Чому вивантаження окремо від екрана ─────────────────────────────────
 *
 * Файл виходить із системи. Він лягає бухгалтеру на стіл, їде в пошту, живе
 * на диску рік — і виправити його потім не можна, на відміну від екрана, який
 * просто перемальовується. Тому «ширший, ніж треба» тут коштує більше:
 *
 *   `bookings/export-csv`  — імена гостей, пошта, телефони, громадянство і
 *                            гроші. У шапці запиту вже стоїть слід минулої
 *                            вади того самого роду: «on SQLite one hotel's
 *                            report downloaded every hotel's guests in one
 *                            file». Ту половину (орендар) полагоджено; вісь
 *                            ОБʼЄКТА лишалась відкритою;
 *   `invoices/export`      — те саме для фактур;
 *   `gift-cards` (список)  — ваучери з номіналами й одержувачами. Вісь тут
 *                            була НЕОБОВʼЯЗКОВИМ параметром і читалась двома
 *                            іменами (`propertyId` і `property_id`) — рівно
 *                            той розкол імен, через який правка INC-037 без
 *                            маршруту нічого б не змінила.
 *
 * ── Пастка нульової колонки, і тут вона третя ───────────────────────────
 *
 * `invoices` не має `property_id` взагалі: обʼєкт приходить від броні через
 * `LEFT JOIN`. Фактура без броні (вручну виписана, сторно) обʼєкта не має, і
 * звичайний фільтр викинув би її з КОЖНОГО вивантаження — документ, якого
 * бухгалтер не побачить ніде. Тому `propertyOrSharedFilter` (Д51), і така
 * фактура в фікстурі Є та порахована.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Броні 2/3/5, фактури 3/4/6. Твердження стоять не лише на лічильнику, а й на
 * ІМЕНАХ: номер броні й номер фактури несуть букву обʼєкта, тож «взяв чужий
 * список» видно рядком, а не тільки числом.
 *
 * ── Чого тут НЕМАЄ, і чому ──────────────────────────────────────────────
 *
 * Списку ваучерів (`gift-cards/route.ts`). Він загорнутий у `withPermission`,
 * а той кличе `cookies()` з `next/headers`, який поза запитом Next КИДАЄ —
 * тобто загорнутий маршрут неможливо покликати з `.check.ts` під голим node.
 * Два вивантаження нижче доступні тому, що їхні тіла винесені в іменовані
 * експортовані функції — тим самим рухом, яким це вже зроблено в
 * `data/reservation-invoice.repo.ts`. Для ваучерів цього замало: їхній шар
 * даних живе в `modules/widget` (чужа тека), і правка мала б починатися
 * звідти. Названо у звіті.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-list-export-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { exportBookings } = await import('./bookings/export-csv/route.ts');
const { exportInvoices } = await import('./invoices/export/route.ts');
const { accountingInvoiceList } = await import('./accounting/invoices/list/route.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const A = fx.a.reservationIds.length;   // 2
const B = fx.b.reservationIds.length;   // 3

await runWithOrganization(fx.organizationId, async () => {
  // Ваучери: по одному на бронь, код несе букву обʼєкта.
  let n = 0;
  for (const [side, prop, ids] of [['A', fx.a.id, fx.a.reservationIds], ['B', fx.b.id, fx.b.reservationIds]] as const) {
    for (const _ of ids) {
      n += 1;
      await sql.run(
        `INSERT INTO gift_cards (id, organization_id, property_id, code, name, face_value, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [`__lex__gc${n}`, fx.organizationId, prop, `GC-${side}-${n}`, `Ваучер ${side}`, 500]);
    }
  }
  // Фактури: по одній на бронь плюс ОДНА без броні — вісь нульового випадку.
  let k = 0;
  for (const [side, ids] of [['A', fx.a.reservationIds], ['B', fx.b.reservationIds]] as const) {
    for (const reservationId of ids) {
      k += 1;
      await sql.run(
        `INSERT INTO invoices (id, organization_id, reservation_id, invoice_number, issued_at, amount, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, 'EUR', 'issued')`,
        [`__lex__inv${k}`, fx.organizationId, reservationId, `INV-${side}-${k}`, fx.from, 100]);
    }
  }
  await sql.run(
    `INSERT INTO invoices (id, organization_id, reservation_id, invoice_number, issued_at, amount, currency, status, is_custom, custom_buyer_name)
     VALUES (?, ?, NULL, ?, ?, ?, 'EUR', 'issued', TRUE, ?)`,
    ['__lex__invnull', fx.organizationId, 'INV-БЕЗ-БРОНІ', fx.from, 100, 'Компанія']);
});

const actor = { organizationId: fx.organizationId } as never;
type Handler = (r: never, c: never, a: never) => Promise<Response>;
const call = async (handler: Handler, url: string) =>
  runWithOrganization(fx.organizationId, async () => {
    const res = await handler({ url, nextUrl: new URL(url) } as never, null as never, actor);
    const text = await res.text();
    return { status: res.status, text };
  });

const count = (text: string, needle: RegExp) => (text.match(needle) || []).length;

// ── Вивантаження броней ────────────────────────────────────────────────────

// Діапазон — У ФІКСТУРИ: вивантаження бере її броні, і літерал тут означав би
// «шукати там, де вони лежали в день, коли це писали».
const range = `from=${fx.from}&to=${fx.to}&format=csv`;
const bkA = await call(exportBookings as never, `http://local/api/bookings/export-csv?${range}&property_id=${fx.a.id}`);
say(count(bkA.text, /A1-|A2-/g) > 0 && count(bkA.text, /B1-/g) === 0,
  `у файлі обʼєкта А немає номерів обʼєкта Б (чужих рядків ${count(bkA.text, /B1-/g)})`);

const bkAll = await call(exportBookings as never, `http://local/api/bookings/export-csv?${range}&property_id=all`);
say(count(bkAll.text, /B1-/g) > 0,
  'сказане «усі» лишає обидва обʼєкти у файлі');

// ── Вивантаження фактур, разом із фактурою БЕЗ броні ───────────────────────

const invA = await call(exportInvoices as never, `http://local/api/invoices/export?format=csv&property_id=${fx.a.id}`);
say(count(invA.text, /INV-A-/g) === A && count(invA.text, /INV-B-/g) === 0,
  `фактури обʼєкта А: ${A} своїх, чужих ${count(invA.text, /INV-B-/g)}`);
say(count(invA.text, /INV-БЕЗ-БРОНІ/g) === 1,
  'фактура БЕЗ броні лишається у вивантаженні обʼєкта — інакше її не побачить ніхто');

const invAll = await call(exportInvoices as never, 'http://local/api/invoices/export?format=csv&property_id=all');
say(count(invAll.text, /INV-/g) === A + B + 1,
  `сказане «усі» дає ${A + B + 1} фактур, отримали ${count(invAll.text, /INV-/g)}`);

// ── Бухгалтерський список фактур ───────────────────────────────────────────
//
// Той самий рід, що вивантаження: список несе номери, покупців і суми, і в
// коментарі над його запитом уже зафіксована ПОЛОВИНА того самого класу —
// «the tenant is named here, not left to the policy». Вісь обʼєкта лишалась
// відкритою.

const accA = await call(accountingInvoiceList as never, `http://local/api/accounting/invoices/list?property_id=${fx.a.id}`);
// Відповідь — ПЛОСКИЙ масив, не обгорнутий обʼєкт: форма теж твердження.
const accBody = JSON.parse(accA.text) as unknown;
say(Array.isArray(accBody), `бухгалтерський список віддає масив (${typeof accBody})`);
const accRows = (Array.isArray(accBody) ? accBody : []) as { invoice_number: string }[];
say(accRows.filter((r) => /INV-A-/.test(r.invoice_number)).length === A
  && accRows.filter((r) => /INV-B-/.test(r.invoice_number)).length === 0,
  `бухгалтерський список обʼєкта А: ${A} своїх, чужих ${accRows.filter((r) => /INV-B-/.test(r.invoice_number)).length}`);
say(accRows.some((r) => r.invoice_number === 'INV-БЕЗ-БРОНІ'),
  'фактура БЕЗ броні лишається і в бухгалтерському списку');

// ── Пакет ISDOC сцени тут НЕ має, і причина названа ────────────────────────
//
// `accounting/isdoc-batch` переведено тим самим рухом (та сама таблиця, ті
// самі двері `propertyOrSharedFilter`, той самий коментар про полагоджену
// половину орендаря). Сцени немає не через ZIP: імена файлів JSZip кладе в
// заголовки нестисненими, тож твердження про них було б можливе. Імпорт
// маршруту тягне `domain/invoice-pdf.ts`, а той на верхньому рівні читає
// `__dirname` — у модулі ESM його немає, і перевірка падає ще до першого
// твердження.
//
// Тобто це другий рід недосяжності поруч із `cookies()` вище, і обидва — не
// про вісь.
//
// ЗАКРИТО 09.09.2026, і не косметично: `__dirname` у `invoice-pdf.ts` замінено
// на `typeof __dirname` (у бандлі Next кандидат той самий, під ESM його просто
// немає). Прогалина протрималась рівно доти, доки в неї не заглянули — і в ній
// лежав INC-043: `accounting/invoice-batch/zip` не мав орендаря ВЗАГАЛІ і
// віддавав ZIP із фактурами чужої компанії. Сцена на нього —
// `accounting/invoice-batch-scope.check.ts`.
//
// `isdoc-batch` тепер теж досяжний; своєї сцени він поки не має, і це чесна
// прогалина, а не «неможливо»: та сама родина, ті самі двері, і числа доведені
// сусідньою сценою на тій самій таблиці.

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nlist-export-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log('list-export-scope: списки і файли, що виходять із системи, — по обраному обʼєкту');
assert.ok(true);
