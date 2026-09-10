/**
 * Одне число — одне джерело: строк, який бачить оператор, і строк, який
 * лягає в документ, походять з ОДНОГО місця (задача 13 §В).
 *
 *   node src/modules/invoicing/domain/payment-terms.check.ts
 *
 * ── Про що це твердження ────────────────────────────────────────────────
 *
 * Не «дефолт дорівнює 14». Число можна змінити завтра, і твердження про
 * нього тоді доведеться правити — тобто воно стереже ВІЗЕРУНОК (§3.2.1).
 * Твердження тут про ЗВʼЯЗОК: змінюєш число в одному місці — рухаються
 * ОБИДВА кінці, і екран, і документ. Тому фікстура не називає 14 ніде, крім
 * одного контрольного рядка, який доводить, що дефолт узагалі читається.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * * ТРИ джерела строку — названий у запиті, строк фірми, дефолт — і між ними
 *   порядок. З двома «фірма перемагає дефолт» не відрізнити від «фірма
 *   перемагає все»;
 * * ДВА різні числа днів у фірм (7 і 30) і третє в дефолті: з рівними
 *   «узяли строк фірми» істинне й на коді, який бере сталу;
 * * ДВІ дати виписки, бо додавання днів має рухати результат, а не повертати
 *   сталу.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PAYMENT_TERMS_DAYS, dueDateFrom, customInvoiceDue,
} from './payment-terms.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// ── 1. Арифметика рухається, а не повертає сталу ─────────────────────────
const A = dueDateFrom('2026-11-05', 7);
const B = dueDateFrom('2026-11-05', 30);
const C = dueDateFrom('2026-12-28', 7);
say(A === '2026-11-12', `+7 днів від 5.11 = 12.11, отримали ${A}`);
say(B === '2026-12-05', `+30 днів від 5.11 = 5.12, отримали ${B}`);
say(C === '2027-01-04', `і через межу року: +7 від 28.12 = 4.01, отримали ${C}`);

// ── 2. Три джерела, і порядок між ними ───────────────────────────────────
//
// Числа днів РІЗНІ (7 і 30) і жодне не дорівнює дефолту — інакше «узяли строк
// фірми» було б зелене й на коді, який бере сталу.
const named = customInvoiceDue('2026-11-20', '2026-11-05', 7);
say(named === '2026-11-20', `названий у запиті строк перемагає все: ${named}`);
const byCompanyShort = customInvoiceDue('', '2026-11-05', 7);
const byCompanyLong = customInvoiceDue(null, '2026-11-05', 30);
say(byCompanyShort === '2026-11-12' && byCompanyLong === '2026-12-05',
  `строк ФІРМИ, і дві різні фірми дають різне: ${byCompanyShort} і ${byCompanyLong}`);
const fallback = customInvoiceDue(undefined, '2026-11-05', null);
say(fallback === dueDateFrom('2026-11-05', DEFAULT_PAYMENT_TERMS_DAYS),
  `фірми не названо — дефолт, і саме той, що в константі: ${fallback}`);
say(byCompanyShort !== fallback && byCompanyLong !== fallback,
  'і жоден зі строків фірми з дефолтом не збігається — вісь не вироджена');

// ── 3. Контрольний: дефолт узагалі читається ─────────────────────────────
//
// Єдине місце, де число назване. Якщо його змінять — червоніє рівно один
// рядок, а не пів сцени; це і є ознака того, що решта тверджень про звʼязок,
// а не про число.
say(DEFAULT_PAYMENT_TERMS_DAYS === 14,
  `дефолт вільної фактури — ${DEFAULT_PAYMENT_TERMS_DAYS} днів (єдине місце, де число назване)`);

// ── 4. ЗВʼЯЗОК: ні екран, ні маршрут не рахують строк самі ───────────────
//
// Друга половина твердження, і вона структурна навмисно: «одне джерело» — це
// властивість РОЗТАШУВАННЯ, її не спитати в чистої функції. Тому питається
// не «чи є там число 14» (це був би візерунок), а «чи додає цей файл дні до
// дати власноруч» — будь-яким написанням: `setDate`, `setUTCDate`,
// `+ N * 86400000`. Файл, який будує дату сам, має ДРУГЕ джерело того самого
// факту, хоч би яке число він при цьому взяв.
const SELF_MATH = /set(UTC)?Date\s*\(|86[_ ]?400[_ ]?000|\* *24 *\* *60 *\* *60/;
for (const rel of [
  'src/app/app/(dashboard)/documents/page.tsx',
  'src/app/api/invoices/custom/route.ts',
]) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const own = SELF_MATH.test(src);
  const door = /@invoicing\/terms/.test(src);
  say(!own && door,
    `${rel.split('/').pop()}: строк дверима, не власною арифметикою`
    + `${own ? ' — РАХУЄ САМ' : ''}${door ? '' : ' — дверей не імпортує'}`);
}

// І самоперевірка самого вимірювача: правило, яке не червоніє на зразку,
// нічого не стереже (§3.2). Три написання тієї самої помилки.
for (const sample of [
  "const d = new Date(); d.setDate(d.getDate() + 14);",
  "const d = new Date(); d.setUTCDate(d.getUTCDate() + 14);",
  "const due = new Date(Date.now() + 14 * 86400000);",
]) {
  if (!SELF_MATH.test(sample)) {
    console.error(`payment-terms.check: самоперевірка — власна арифметика не впізнана у зразку:\n  ${sample}`);
    process.exit(2);
  }
}
if (SELF_MATH.test("const due = customInvoiceDue(form.dueDate, todayIso());")) {
  console.error('payment-terms.check: самоперевірка — виклик дверей порахований власною арифметикою');
  process.exit(2);
}

if (fails.length) {
  console.log(`\npayment-terms: ${fails.length} червоних`);
  process.exit(1);
}
console.log('payment-terms: строк має ОДНЕ джерело — екран і документ читають те саме');
assert.ok(true);
