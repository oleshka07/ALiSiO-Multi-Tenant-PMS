/**
 * Одна фактура фірмі за кілька перебувань — і жодна бронь від цього не
 * подешевшала (Д57, хвиля Winhotel §2).
 *
 *   node src/modules/invoicing/data/payer-folio.check.ts
 *
 * ── Що ламається ────────────────────────────────────────────────────────
 *
 * Готель продає фірмам і виставляє ОДНУ фактуру за пʼять перебувань
 * (`RECHNUNG.VERK_NR` у Winhotel). У нас це було неможливо: `moveCharges`
 * відмовляла, щойно рядок і цільове фоліо належали різним броням.
 *
 * ── Відмова стояла там НАВМИСНО, і це головне ───────────────────────────
 *
 * У коді написано чому: «splitting who PAYS must not change what is OWED».
 * Вона стерегла властивість, яку легко втратити мовчки: поділ «хто платить» не
 * сміє міняти «скільки винні за цю бронь». Знімаючи відмову, ми лишаємось без
 * сторожа — тож твердження про суму мусить стати на його місце, і саме тому
 * воно в ОДНІЙ сцені з переносом, а не в сусідній.
 *
 * Друге твердження без першого — це стара поведінка (нічого не переносили,
 * суми звісно цілі). Перше без другого — це втрачені гроші, яких ніхто не
 * помітить до кінця місяця.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * * ДВІ броні: з однією «рядки різних броней лягли разом» нічого не означає;
 * * РІЗНІ суми броней (300 і 700): рівні дали б 1000 і при переносі, і при
 *   подвоєнні однієї — сума не розрізняла б прочитань;
 * * ДВІ фірми: без сусідньої «чужий платник — відмова» істинне й на коді,
 *   який відмовляє всім.
 *
 * ── Чому КОЖНЕ читання під `runWithOrganization` ────────────────────────
 *
 * Перший прогін на справжньому Postgres дав пʼять червоних там, де SQLite
 * давав зелень: виміри сцени ходили голим `sql.row` — без орендаря. На
 * SQLite політик немає, тож вони бачили все; на Postgres із `FORCE ROW LEVEL
 * SECURITY` вони бачили ПОРОЖНЕ, і сцена доповіла «борг 0 і 0» замість
 * «300 і 700». Це той самий клас, що AGENTS §7 називає головним: не помилка,
 * а тиха порожнеча. Мірило, яке саме читає повз орендаря, вимірює не те.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-payer-folio-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { createCompany } = await import('../../companies/data/companies.repo.ts');
const folio = await import('./folio.repo.ts');

const sql = getSql();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const ORG = '__pf_org';
const PROP = '__pf_prop';
const GUEST = '__pf_guest';
// Суми РІЗНІ і не кратні одна одній: 1000 у сумі можна отримати лише як
// 300 + 700, тобто «перенесли обидві», а не «подвоїли одну».
const SUM_A = 300;
const SUM_B = 700;
const TERMS_DAYS = 21;   // не 14: саме 14 зашито в старому маршруті вільної фактури

// Прибирання — ПІД ОРЕНДАРЕМ, і це не формальність: на Postgres із
// `FORCE ROW LEVEL SECURITY` `DELETE` без контексту не падає, він видаляє
// НУЛЬ рядків (інваріант 11). Сцена в спільній базі `check:pg` тоді падала б
// на другому прогоні через первинний ключ, і причина виглядала б як «сцена
// зламана», а не як «прибирання нічого не прибрало».
await runWithOrganization(ORG, async () => {
  for (const t of ['fin_folio_payments', 'fin_invoice_lines', 'fin_invoice_tax_totals',
                   'invoices', 'fin_folio_items', 'fin_folios',
                   'reservations', 'guests', 'properties', 'companies']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => undefined);
  }
});
// `organizations` — таблиця особи, політики на ній немає (IDENTITY), тож цей
// рядок видаляється поза орендарем і саме тому останнім.
await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]).catch(() => undefined);
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'Payer Folio', ORG]);

const ours = await runWithOrganization(ORG, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
    [PROP, ORG, 'House', 'house']);
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    [GUEST, ORG, 'Guest', 'One']);
  const mine = await createCompany(ORG, { name: 'Наша фірма', payment_terms_days: TERMS_DAYS });
  const other = await createCompany(ORG, { name: 'Сусідня фірма' });
  for (const [id, company, total] of [['__pf_r1', mine, SUM_A], ['__pf_r2', mine, SUM_B], ['__pf_r3', other, 500]] as const) {
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, guest_id, company_id,
                                 check_in, check_out, nights, adults, total_price, currency, status, source)
       VALUES (?, ?, ?, ?, ?, '2026-11-01', '2026-11-02', 1, 1, ?, 'EUR', 'confirmed', 'direct')`,
      [id, ORG, PROP, GUEST, company, total]);
  }
  return { mine, other };
});

/** Сума ВСІХ рядків цієї броні, де б вони не лежали. Саме її стерегла відмова. */
const owedBy = async (reservationId: string) => runWithOrganization(ORG, async () => {
  const r = await sql.row<{ total: number }>(
    `SELECT COALESCE(SUM(total_gross), 0) AS total FROM fin_folio_items
      WHERE organization_id = ? AND reservation_id = ?`, [ORG, reservationId]);
  return Math.round(Number(r?.total ?? 0) * 100) / 100;
});

const charge = async (reservationId: string, folioId: string, gross: number) =>
  sql.run(
    `INSERT INTO fin_folio_items (id, organization_id, folio_id, reservation_id, kind, source,
                                  service_date, description, quantity, unit_price_gross, total_gross, vat_rate)
     VALUES (?, ?, ?, ?, 'lodging', 'nightly', '2026-11-01', 'Ніч', 1, ?, ?, 0)`,
    [`__pf_i_${reservationId}`, ORG, folioId, reservationId, gross, gross]);

const state = await runWithOrganization(ORG, async () => {
  const f1 = await folio.createFolio({ reservationId: '__pf_r1' });
  const f2 = await folio.createFolio({ reservationId: '__pf_r2' });
  const f3 = await folio.createFolio({ reservationId: '__pf_r3' });
  await charge('__pf_r1', f1, SUM_A);
  await charge('__pf_r2', f2, SUM_B);
  await charge('__pf_r3', f3, 500);
  // Фоліо ПЛАТНИКА: без броні, з названою фірмою.
  const payer = await folio.createFolio({ companyId: ours.mine, propertyId: PROP, payerKind: 'company' });
  return { f1, f2, f3, payer };
});

const before = { r1: await owedBy('__pf_r1'), r2: await owedBy('__pf_r2') };
say(before.r1 === SUM_A && before.r2 === SUM_B,
  `до перенесення: бронь 1 винна ${before.r1}, бронь 2 винна ${before.r2}`);

// ── 1. Рядки ДВОХ броней лягають в одне фоліо фірми ──────────────────────

await runWithOrganization(ORG, async () => {
  const items1 = await sql.rows<{ id: string }>(
    'SELECT id FROM fin_folio_items WHERE organization_id = ? AND folio_id = ?', [ORG, state.f1]);
  const items2 = await sql.rows<{ id: string }>(
    'SELECT id FROM fin_folio_items WHERE organization_id = ? AND folio_id = ?', [ORG, state.f2]);
  await folio.moveCharges(items1.map((i) => i.id), state.payer);
  await folio.moveCharges(items2.map((i) => i.id), state.payer);
});

const onPayer = await runWithOrganization(ORG, () => sql.row<{ n: number; total: number }>(
  `SELECT COUNT(*) AS n, COALESCE(SUM(total_gross), 0) AS total FROM fin_folio_items
    WHERE organization_id = ? AND folio_id = ?`, [ORG, state.payer]));
say(Number(onPayer?.n) === 2,
  `на фоліо фірми рядки ОБОХ броней: ${onPayer?.n}`);
say(Math.round(Number(onPayer?.total)) === SUM_A + SUM_B,
  `і сума ${SUM_A + SUM_B} — тобто 300 і 700, а не подвоєна одна: отримали ${onPayer?.total}`);

// ── 2. І жодна бронь від цього не подешевшала ────────────────────────────
//
// Те, що стерегла знята відмова. Без цього твердження перше — це «гроші
// переїхали кудись», а не «переїхали цілими».

const after = { r1: await owedBy('__pf_r1'), r2: await owedBy('__pf_r2') };
say(after.r1 === before.r1 && after.r2 === before.r2,
  `після перенесення борг кожної броні той самий: ${after.r1} і ${after.r2}`);

// ── 3. Чужий платник — названа відмова ───────────────────────────────────

let refusal = '';
await runWithOrganization(ORG, async () => {
  const items3 = await sql.rows<{ id: string }>(
    'SELECT id FROM fin_folio_items WHERE organization_id = ? AND folio_id = ?', [ORG, state.f3]);
  try {
    await folio.moveCharges(items3.map((i) => i.id), state.payer);
  } catch (e) { refusal = String((e as Error).message); }
});
say(refusal.length > 0, `бронь СУСІДНЬОЇ фірми на це фоліо не їде: «${refusal || 'проїхала!'}»`);
const stillThere = await runWithOrganization(ORG, () => sql.row<{ n: number }>(
  'SELECT COUNT(*) AS n FROM fin_folio_items WHERE organization_id = ? AND folio_id = ?', [ORG, state.f3]));
say(Number(stillThere?.n) === 1, `і її рядок лишився на своєму фоліо: ${stillThere?.n}`);

// ── 4. Одна фактура на обидва перебування, зі строком із умов фірми ──────
//
// `TERMS_DAYS = 21`, а не 14: рівно 14 зашито в старому маршруті вільної
// фактури, і з ними «виведено з умов» не відрізнити від «підставлено число».

const issued = await runWithOrganization(ORG, () => folio.issueInvoice({ folioId: state.payer, issueDate: '2026-11-05' }));
say(Math.round(issued.gross) === SUM_A + SUM_B,
  `одна фактура покриває обидва перебування: ${issued.gross}`);
say(issued.lines === 2, `і має рядки обох, ${issued.lines}`);

const inv = await runWithOrganization(ORG, () => sql.row<{ due_date: string | null }>(
  'SELECT due_date FROM invoices WHERE id = ? AND organization_id = ?', [issued.invoiceId, ORG]));
say(String(inv?.due_date ?? '').slice(0, 10) === '2026-11-26',
  `строк оплати — з умов фірми (5.11 + ${TERMS_DAYS} днів = 26.11), отримали ${inv?.due_date}`);

// ── 5. «Відкриті фактури фірми»: сплачене віднімається, а не позначається ─

const openBefore = await runWithOrganization(ORG, () => folio.openInvoicesOfCompany(ours.mine));
say(openBefore.length === 1 && openBefore[0].open === SUM_A + SUM_B,
  `до оплати відкрито ${openBefore[0]?.open} однією фактурою`);

// ── 5a. Прострочення — опора для «дебіторки», і воно ПОХІДНЕ ─────────────
//
// ТРИ дати спостереження, і третя додана після того, як другий злом НЕ
// почервонів. Перші дві були «у день строку 0» і «через пʼять днів 5» — і
// вони обидві зелені на коді без нижньої межі (`return days` замість
// `days > 0 ? days : 0`): у день строку різниця і так рівно нуль. Тобто та
// сама помилка, записана інакше, проходила повз — §3.2.1 дослівно.
//
// Третя дата (за 16 днів ДО строку) робить властивість перевірюваною: без
// межі там вийшло б −16, і жодне з трьох чисел не сходиться з
// альтернативними прочитаннями — «днів від виписки» дало б 5, 21 і 26.
const early = await runWithOrganization(ORG, () => folio.openInvoicesOfCompany(ours.mine, '2026-11-10'));
say(early[0]?.overdue_days === 0,
  `до строку прострочення 0, а не відʼємне: отримали ${early[0]?.overdue_days}`);
const onDue = await runWithOrganization(ORG, () => folio.openInvoicesOfCompany(ours.mine, '2026-11-26'));
say(onDue[0]?.overdue_days === 0,
  `у день строку прострочення 0, отримали ${onDue[0]?.overdue_days}`);
const late = await runWithOrganization(ORG, () => folio.openInvoicesOfCompany(ours.mine, '2026-12-01'));
say(late[0]?.overdue_days === 5,
  `через пʼять днів після строку — 5, отримали ${late[0]?.overdue_days}`);

const PART = 400;
await runWithOrganization(ORG, () => sql.run(
  `INSERT INTO fin_folio_payments (id, organization_id, folio_id, invoice_id, amount, method)
   VALUES (?, ?, ?, ?, ?, 'transfer')`,
  ['__pf_pay', ORG, state.payer, issued.invoiceId, PART]));

const openAfter = await runWithOrganization(ORG, () => folio.openInvoicesOfCompany(ours.mine));
say(openAfter.length === 1 && openAfter[0].open === SUM_A + SUM_B - PART,
  `частковий внесок ${PART} зменшує борг рівно на себе: ${openAfter[0]?.open}`);

await runWithOrganization(ORG, () => sql.run(
  `INSERT INTO fin_folio_payments (id, organization_id, folio_id, invoice_id, amount, method)
   VALUES (?, ?, ?, ?, ?, 'transfer')`,
  ['__pf_pay2', ORG, state.payer, issued.invoiceId, SUM_A + SUM_B - PART]));
const openDone = await runWithOrganization(ORG, () => folio.openInvoicesOfCompany(ours.mine));
say(openDone.length === 0, `сплачена цілком — зі списку відкритих зникає: лишилось ${openDone.length}`);

// ── 6. Умов оплати немає — і відповідей ДВІ, за родом фоліо (Д59) ────────
//
// Вісь тут — САМЕ РІД ФОЛІО, і фікстура має обидва його значення: фоліо
// платника сусідньої фірми (без умов) і звичайне фоліо її ж стою. З одним
// родом твердження зелене і на коді, який відмовляє завжди, і на коді, який
// не відмовляє ніколи. Фірма в обох випадках та сама — тобто різницю робить
// рід фоліо, а не фірма.

let noTerms = 'не відмовило зовсім';
await runWithOrganization(ORG, async () => {
  const payerOther = await folio.createFolio({ companyId: ours.other, propertyId: PROP, payerKind: 'company' });
  const items3 = await sql.rows<{ id: string }>(
    'SELECT id FROM fin_folio_items WHERE organization_id = ? AND folio_id = ?', [ORG, state.f3]);
  await folio.moveCharges(items3.map((i) => i.id), payerOther);
  try {
    await folio.issueInvoice({ folioId: payerOther, issueDate: '2026-11-05' });
  } catch (e) { noTerms = String((e as Error).message); }
});
say(/payment terms/i.test(noTerms),
  `фоліо ПЛАТНИКА без умов оплати — названа відмова: «${noTerms}»`);

// А звичайне фоліо стою тієї самої фірми — виписується, і строку в нього
// просто НЕМАЄ. Не 14 днів, не сьогодні: відсутність, а не дефолт.
// Виняток тут ЛОВИТЬСЯ, а не пускається назовні. Сцена, яка падає стеком,
// червоніє не про те, що стверджує: у виводі `npm run check` це читається як
// «сцена зламана», і саме так виглядав злом «відмовляти ЗАВЖДИ», поки цього
// `catch` не було — вихід ненульовий, а жодного рядка про твердження немає.
const stayOther = await runWithOrganization(ORG, async () => {
  const f = await folio.createFolio({ reservationId: '__pf_r3' });
  await sql.run(
    `INSERT INTO fin_folio_items (id, organization_id, folio_id, reservation_id, kind, source,
                                  service_date, description, quantity, unit_price_gross, total_gross, vat_rate)
     VALUES (?, ?, ?, ?, 'lodging', 'nightly', '2026-11-01', 'Ніч', 1, 500, 500, 0)`,
    ['__pf_i_stay_other', ORG, f, '__pf_r3']);
  try {
    const res = await folio.issueInvoice({ folioId: f, issueDate: '2026-11-05' });
    const inv = await sql.row<{ due_date: string | null }>(
      'SELECT due_date FROM invoices WHERE id = ? AND organization_id = ?', [res.invoiceId, ORG]);
    return { due: inv?.due_date ?? null, refused: '' };
  } catch (e) { return { due: null, refused: String((e as Error).message) }; }
});
say(stayOther.refused === '' && stayOther.due === null,
  `звичайне фоліо стою тієї самої фірми виписується БЕЗ строку: `
  + `${stayOther.refused ? `ВІДМОВИЛО — «${stayOther.refused}»` : String(stayOther.due)}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\npayer-folio: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`payer-folio: одна фактура на дві броні (${SUM_A}+${SUM_B}), і борг кожної броні цілий`);
assert.ok(true);
