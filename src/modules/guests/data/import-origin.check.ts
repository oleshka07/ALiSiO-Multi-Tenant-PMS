/**
 * Повторний імпорт не заводить тих самих людей удруге (INC-301, CORE-GAPS п. 12).
 *
 *   DB_DRIVER=postgres DATABASE_URL=… node src/modules/guests/data/import-origin.check.ts
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * Імпорт Winhotel прогонять щонайменше двічі: раз пробно, раз насправді. Без
 * ключа походження другий прогін заведе всі 34 795 живих адрес удруге — і
 * дублікати розповзуться по бронях, фактурах і згодах ще до того, як хтось
 * гляне на результат.
 *
 * ── Тримає це БАЗА, а не уважність імпортера ────────────────────────────
 *
 * Частковий UNIQUE-індекс на (організація, `external_ref`) робить другий запис
 * тієї самої вихідної адреси неможливим. Це той самий довід, що INC-045:
 * правило, яке має тримати база, не лишають циклу, який хтось напише вдруге.
 *
 * ── Три осі, і кожна має пару ───────────────────────────────────────────
 *
 *   той самий ключ у ТОМУ САМОМУ рахунку — відмова бази;
 *   той самий ключ у ЧУЖОМУ рахунку — проходить (унікальність із орендарем,
 *     інваріант 3): два готелі можуть імпортувати з двох різних Winhotel, і
 *     `ADRESSEN.LNR = 1` є в обох;
 *   БЕЗ ключа — скільки завгодно рядків: гість, заведений рецепцією,
 *     походження не має. Це твердження про ПОВЕДІНКУ, і воно навмисно не
 *     розрізняє, чи є в індексі предикат: виміряно, що два NULL проходять і
 *     без нього, бо в унікальному індексі NULL-и не рівні між собою. Предикат
 *     керує розміром індексу — див. шапку 0301.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-import-origin-'));
if (process.env.DB_DRIVER !== 'postgres') process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();
const ORG = fx.organizationId;

const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(ORG, fn);
const inTheirs = <T>(fn: () => Promise<T>) => runWithOrganization(neighbour.organizationId, fn);

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

/** Ключ походження — назва системи, таблиці й ідентифікатора в ній. */
const WINHOTEL_ADDRESS_1 = 'winhotel:adressen:1';

const importGuest = (organizationId: string, id: string, ref: string | null) =>
  runWithOrganization(organizationId, () => sql.run(
    `INSERT INTO guests (id, organization_id, first_name, last_name, external_ref)
     VALUES (?, ?, 'Gast', 'Eins', ?)`, [id, organizationId, ref]));

const tried = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { return e as Error; }
};

// ── 1. Той самий рядок джерела двічі — відмовляє БАЗА ────────────────────────
await importGuest(ORG, 'io_first', WINHOTEL_ADDRESS_1);
const again = await tried(() => importGuest(ORG, 'io_second', WINHOTEL_ADDRESS_1));
say(again !== null,
  'другий імпорт тієї самої адреси відхилено БАЗОЮ, а не уважністю імпортера');
say(await inOurs(async () => Number((await sql.row<{ n: number }>(
  'SELECT COUNT(*) AS n FROM guests WHERE external_ref = ?', [WINHOTEL_ADDRESS_1]))?.n ?? 0)) === 1,
  'у базі рівно один гість на один рядок джерела');

// ── 2. Пара: чужий рахунок той самий ключ приймає ────────────────────────────
//
// Без цієї половини твердження вище зелене й на ТОТАЛЬНІЙ унікальності, яка
// зробила б неможливим імпорт другого готелю: `ADRESSEN.LNR = 1` є в кожній
// базі Winhotel на світі.
const neighbourToo = await tried(() =>
  importGuest(neighbour.organizationId, 'io_theirs', WINHOTEL_ADDRESS_1));
say(neighbourToo === null,
  'сусідній рахунок імпортує СВІЙ рядок із тим самим номером — унікальність із орендарем');

// ── 3. Пара: без ключа походження рядків скільки завгодно ────────────────────
//
// Гість, заведений рецепцією, походження не має, і таких більшість. Твердження
// про поведінку, не про форму індексу: злом «прибрати предикат» лишає його
// ЗЕЛЕНИМ, і це правильно — у унікальному індексі NULL-и не рівні між собою.
await importGuest(ORG, 'io_manual_1', null);
const manualTwo = await tried(() => importGuest(ORG, 'io_manual_2', null));
say(manualTwo === null,
  'двоє гостей без походження співіснують — індекс частковий, NULL не конфліктує з NULL');

// ── 4. Те саме для броней, і ключ каналу лишається своїм ─────────────────────
//
// `external_uid` уже зайнятий iCal-синком і каналами (він там навіть не ключ —
// його ділять кілька шляхів). Тому походження імпорту живе в СВОЇЙ колонці:
// інакше «звідки ця бронь» відповідало б те, що записало останнім.
const importBooking = (id: string, ref: string | null, uid: string | null) => inOurs(() => sql.run(
  `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                             check_in, check_out, nights, adults, currency, external_ref, external_uid)
   VALUES (?, ?, ?, ?, 'io_first', '2027-09-01', '2027-09-03', 2, 2,
           (SELECT default_currency FROM organizations WHERE id = ?), ?, ?)`,
  [id, ORG, fx.a.id, fx.b.unitIds[0], ORG, ref, uid]));

await importBooking('io_r1', 'winhotel:gastkont:77', 'ical-abc');
const bookingAgain = await tried(() => importBooking('io_r2', 'winhotel:gastkont:77', null));
say(bookingAgain !== null, 'повторний імпорт тієї самої броні відхилено базою');

const row = await inOurs(() => sql.row<{ external_ref: string; external_uid: string }>(
  'SELECT external_ref, external_uid FROM reservations WHERE id = ?', ['io_r1']));
say(row?.external_ref === 'winhotel:gastkont:77' && row?.external_uid === 'ical-abc',
  'походження імпорту і ключ каналу живуть поруч і не затирають одне одного');

if (process.env.DB_DRIVER !== 'postgres') fs.rmSync(tmp, { recursive: true, force: true });
assert.deepStrictEqual(fails, [], `не виконано: ${fails.join('; ')}`);
console.log('import-origin: повторний прогін імпорту не двоїть ні гостей, ні броней — і це тримає база');
