/**
 * Номер дебітора видає ГОТЕЛЬ, і він унікальний у межах рахунку (Д56).
 *
 *   node src/modules/companies/data/debtor-no.check.ts
 *
 * ── Що ламається ────────────────────────────────────────────────────────
 *
 * `fin_folios.payer_debtor_no` заповнювався з `companies.business_id`, тобто
 * номер дебітора = IČO. Це тиха підміна двох різних речей: реєстраційний номер
 * фірми видає ДЕРЖАВА, номер дебітора видає ГОТЕЛЬ зі свого діапазону, і саме
 * він їде в бухгалтерію (`DEBI_NR` у DATEV). Фірма без IČO — приватна особа,
 * закордонний партнер — узагалі лишалась без номера, тобто без рядка в книзі
 * дебіторів.
 *
 * ── Три властивості, і кожна коштує грошей ──────────────────────────────
 *
 * 1. **Номер видається послідовно з лічильника рахунку.** Пропуск або повтор —
 *    це рядок у чужій картці дебітора.
 * 2. **Унікальність — НА ОРГАНІЗАЦІЮ, не глобальна.** Глобальна означала б, що
 *    другий готель не може мати дебітора 10001, бо його взяв перший, — тобто
 *    ми ламаємо звичну нумерацію кожному, хто переїжджає до нас другим.
 * 3. **Перегони не видають один номер двічі.** Два портьє заводять фірму в ту
 *    саму секунду; лічильник, прочитаний і записаний двома окремими запитами,
 *    віддасть обом одне число.
 *
 * Форма відповіді на (3) — та сама, що в `allocateInvoiceNumber`
 * (`invoicing/domain/invoice-numbering.ts`): збільшення і читання ОДНИМ
 * запитом-інкрементом усередині однієї транзакції. `UPDATE … SET x = x + 1`
 * бере замок рядка, тож другий викликач чекає й читає вже нове значення.
 * Написано втретє в проєкті — і саме тому тут посилання, а не четверта копія.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * * ДВІ організації з РІЗНИМИ стартами лічильника: з одним рахунком «унікально
 *   на організацію» не відрізнити від «унікально глобально», а з однаковими
 *   стартами — не побачити, що лічильник свій у кожного;
 * * старт НЕ з одиниці: з дефолтного старту «взяли лічильник рахунку» і «взяли
 *   перший вільний» дають те саме число.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-debtor-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { createCompany, getCompany, allocateDebtorNo, DuplicateBusinessId } = await import('./companies.repo.ts');

const sql = getSql();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// ── Фікстура: два рахунки з РІЗНИМИ стартами ─────────────────────────────
//
// Числа не з життя клієнта (інваріант 20), але не одиниця й не сусідні: старт
// 4200 і 7700 арифметично несумісні, тож «узяв не той лічильник» видно одразу.
const ORG_A = '__dn_org_a';
const ORG_B = '__dn_org_b';
const START_A = 4200;
const START_B = 7700;

for (const [id, start] of [[ORG_A, START_A], [ORG_B, START_B]] as const) {
  await sql.run("DELETE FROM companies WHERE organization_id = ?", [id]).catch(() => undefined);
  await sql.run('DELETE FROM organizations WHERE id = ?', [id]).catch(() => undefined);
  await sql.run(
    'INSERT INTO organizations (id, name, slug, next_debtor_no) VALUES (?, ?, ?, ?)',
    [id, `Org ${id}`, id, start]);
}

// ── 1. Послідовна видача з лічильника СВОГО рахунку ──────────────────────

const firstA = await runWithOrganization(ORG_A, () => createCompany(ORG_A, { name: 'Перша' }));
const secondA = await runWithOrganization(ORG_A, () => createCompany(ORG_A, { name: 'Друга' }));
const rowFirst = await runWithOrganization(ORG_A, () => getCompany(ORG_A, firstA));
const rowSecond = await runWithOrganization(ORG_A, () => getCompany(ORG_A, secondA));

say(Number(rowFirst?.debtor_no) === START_A,
  `перша фірма дістає старт рахунку ${START_A}, отримали ${rowFirst?.debtor_no}`);
say(Number(rowSecond?.debtor_no) === START_A + 1,
  `друга — наступний номер ${START_A + 1}, отримали ${rowSecond?.debtor_no}`);

// ── 2. Унікальність НА ОРГАНІЗАЦІЮ ───────────────────────────────────────
//
// Сусідній рахунок зі своїм стартом; далі його лічильник свідомо ставиться на
// вже зайняте в А число — і воно мусить пройти.
const firstB = await runWithOrganization(ORG_B, () => createCompany(ORG_B, { name: 'Сусідня' }));
const rowB = await runWithOrganization(ORG_B, () => getCompany(ORG_B, firstB));
say(Number(rowB?.debtor_no) === START_B,
  `сусідній рахунок веде СВІЙ лічильник (${START_B}), отримали ${rowB?.debtor_no}`);

await sql.run('UPDATE organizations SET next_debtor_no = ? WHERE id = ?', [START_A, ORG_B]);
const sameNumber = await runWithOrganization(ORG_B, () => createCompany(ORG_B, { name: 'Той самий номер' }));
const rowSame = await runWithOrganization(ORG_B, () => getCompany(ORG_B, sameNumber));
say(Number(rowSame?.debtor_no) === START_A,
  `той самий номер ${START_A} у ДРУГОМУ рахунку — законний, отримали ${rowSame?.debtor_no}`);

// А в тому самому рахунку — ні: індекс мусить відмовити.
let refused = false;
try {
  await runWithOrganization(ORG_A, () => sql.run(
    'INSERT INTO companies (id, organization_id, name, debtor_no) VALUES (?, ?, ?, ?)',
    ['__dn_dup', ORG_A, 'Дублікат', START_A]));
} catch { refused = true; }
say(refused, `той самий номер ДВІЧІ в одному рахунку — відмова бази${refused ? '' : ' (пройшло!)'}`);

// І відмова НАЗИВАЄ СВОЮ причину, а не сусідню.
//
// `companies` має тепер ДВА унікальні індекси, і `createCompany` перекладав
// будь-яке їх порушення в «дубль реєстраційного ID». Фікстура розрізняє їх
// саме тому, що осі дві: зіткнення за номером дебітора при РІЗНИХ (тут —
// відсутніх) реєстраційних номерах, і зіткнення за реєстраційним номером
// при різних номерах дебітора. Одна вісь лишила б обидва прочитання зеленими.
await runWithOrganization(ORG_A, () => sql.run(
  'UPDATE organizations SET next_debtor_no = ? WHERE id = ?', [START_A, ORG_A]));
let wrongName = 'не відмовило зовсім';
try {
  await runWithOrganization(ORG_A, () => createCompany(ORG_A, { name: 'Зіткнення номерів' }));
} catch (e) {
  wrongName = e instanceof DuplicateBusinessId ? 'сказало «дубль реєстраційного ID»' : '';
}
say(wrongName === '',
  `зіткнення за номером дебітора не видає себе за дубль ID${wrongName ? ` — ${wrongName}` : ''}`);

// Лічильник ведеться далі й після невдалої вставки — номер не перевикористовується,
// тож для наступного твердження його треба відвести на вільне місце.
await runWithOrganization(ORG_A, () => sql.run(
  'UPDATE organizations SET next_debtor_no = ? WHERE id = ?', [START_A + 50, ORG_A]));

const dupIdOrg = await runWithOrganization(ORG_A, async () => {
  await createCompany(ORG_A, { name: 'З ID', business_id: '99887766' });
  try { await createCompany(ORG_A, { name: 'З тим самим ID', business_id: '99887766' }); return 'пройшло!'; }
  catch (e) { return e instanceof DuplicateBusinessId ? '' : `чужим іменем: ${(e as Error).message}`; }
});
say(dupIdOrg === '', `зіткнення за реєстраційним ID — навпаки, назване своїм іменем${dupIdOrg ? ` (${dupIdOrg})` : ''}`);

// ── 3. Перегони не видають один номер двічі ──────────────────────────────
//
// Десять видач ОДНОЧАСНО. Твердження про КІЛЬКІСТЬ різних, а не про значення
// першого: саме так виглядає вада перегонів — два однакових серед десяти.
//
// Осі тут немає на SQLite, і сцена каже це вголос замість мовчазного «зелено»
// (AGENTS §7). Драйвер better-sqlite3 синхронний і однопотоковий: десять
// транзакцій одночасно він не почне взагалі («cannot start a transaction
// within a transaction»), тож твердження про перегони там не про що. Доказ —
// у `check:pg`, де кожен виклик бере своє зʼєднання з пулу.
const onPostgres = (process.env.DB_DRIVER || '').startsWith('p');
await sql.run('UPDATE organizations SET next_debtor_no = ? WHERE id = ?', [START_A + 100, ORG_A]);
if (onPostgres) {
  const raced = await Promise.all(
    Array.from({ length: 10 }, () => runWithOrganization(ORG_A, () => allocateDebtorNo(ORG_A))));
  say(new Set(raced).size === 10,
    `десять одночасних видач — десять РІЗНИХ номерів, отримали ${new Set(raced).size} різних із 10`);
  say(Math.max(...raced) - Math.min(...raced) === 9,
    `і вони підряд, без пропусків: від ${Math.min(...raced)} до ${Math.max(...raced)}`);
} else {
  // Послідовно — це не перегони, і воно так і названо: перевіряється лише те,
  // що видача взагалі рухає лічильник, а не що вона переживає одночасність.
  const one = await runWithOrganization(ORG_A, () => allocateDebtorNo(ORG_A));
  const two = await runWithOrganization(ORG_A, () => allocateDebtorNo(ORG_A));
  say(two === one + 1, `послідовно лічильник рухається: ${one} → ${two}`);
  console.log('  ––  перегони НЕ перевірено: цей рушій не має одночасності (доказ — у check:pg)');
}

// ── Номер із попередньої системи (З37): прийняти замість виданого, лічильник — за ним ──
{
  const { adoptDebtorNo, createCompany: mkCompany, getCompany: readCompany } = await import('./companies.repo.ts');
  const [c1, c2] = await runWithOrganization(ORG_A, async () => [
    await mkCompany(ORG_A, { name: 'Übernommen GmbH' } as any),
    await mkCompany(ORG_A, { name: 'Nachbar KG' } as any),
  ]);
  const issued = Number((await runWithOrganization(ORG_A, () => readCompany(ORG_A, c1)))!.debtor_no);
  const wanted = issued + 5000;
  say((await runWithOrganization(ORG_A, () => adoptDebtorNo(ORG_A, c1, wanted))) === 'adopted', 'номер із попередньої системи приймається');
  say(Number((await runWithOrganization(ORG_A, () => readCompany(ORG_A, c1)))!.debtor_no) === wanted, `у картці — прийнятий номер ${wanted}, не виданий ${issued}`);
  say((await runWithOrganization(ORG_A, () => adoptDebtorNo(ORG_A, c1, wanted))) === 'already', 'той самий номер удруге — already, без запису');
  say((await runWithOrganization(ORG_A, () => adoptDebtorNo(ORG_A, c2, wanted))) === 'taken', 'номер, зайнятий іншою фірмою рахунку, — taken, не виняток');
  say(Number((await runWithOrganization(ORG_A, () => readCompany(ORG_A, c2)))!.debtor_no) !== wanted, 'сусідка свого номера не втратила');
  const next = Number((await sql.row<{ next_debtor_no: number }>('SELECT next_debtor_no FROM organizations WHERE id = ?', [ORG_A]))?.next_debtor_no);
  say(next === wanted + 1, `лічильник рахунку рушив за прийнятим номером: next_debtor_no ${next}, чекали ${wanted + 1}`);
  say((await runWithOrganization(ORG_A, () => adoptDebtorNo(ORG_A, 'no-such-company', 7))) === 'not_found', 'чужа або неіснуюча — not_found');
}

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\ndebtor-no: ${fails.length} червоних`);
  process.exit(1);
}
console.log(onPostgres
  ? 'debtor-no: номер видає готель, він унікальний у рахунку і переживає перегони'
  : 'debtor-no: номер видає готель і унікальний у рахунку (перегони — у check:pg)');
assert.ok(true);
