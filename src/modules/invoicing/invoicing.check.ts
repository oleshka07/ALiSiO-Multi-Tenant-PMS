/**
 * Фактурування не залежить від обліку.
 *
 *   node src/modules/invoicing/invoicing.check.ts
 *
 * ── Що тут тримається ───────────────────────────────────────────────────
 *
 * Розділення модулів існує, поки його ніхто не зшив назад одним імпортом.
 * Зшити легко й непомітно: комусь у фактурі знадобиться категорія витрат,
 * він напише `FROM expense_categories`, і все скомпілюється. Помітно стане
 * тоді, коли готель вимкне облік і фактури перестануть виписуватись.
 *
 * Тому перевірка дивиться в один бік: `@invoicing` не має права торкатись
 * таблиць обліку. Зворотне — можна: облік читає виписані документи, це його
 * робота.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

/** Таблиці, які належать обліку. Жодна не має зустрічатись у @invoicing. */
const BOOKKEEPING = [
  'fin_operations', 'fin_operation_audit', 'fin_operation_tags', 'fin_operation_attachments',
  'finance_accounts', 'finance_counterparties', 'finance_tags', 'business_units',
  'fin_budgets', 'capex_items', 'accruals', 'fin_recurring_templates',
  'fin_auto_rules', 'fin_auto_rule_matches', 'expense_categories',
  'fin_channel_receivables', 'bank_transactions', 'finance_security', 'finance_user_access',
];

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/^\s*--[^\n]*/gm, '');

const files: string[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    // Сама перевірка — не файл модуля: у ній список таблиць обліку лежить
    // за визначенням, і без цього рядка вона ловила саму себе.
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('invoicing.check.ts')) files.push(p);
  }
})('src/modules/invoicing');

const leaks: string[] = [];
for (const file of files) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  for (const t of BOOKKEEPING) {
    if (new RegExp(`\\b${t}\\b`).test(src)) leaks.push(`${file} → ${t}`);
  }
  // Імпорт із модуля обліку — те саме іншими словами.
  if (/from '@finance'|modules\/finance\//.test(src)) leaks.push(`${file} → імпорт @finance`);
}
assert.deepStrictEqual(leaks, [],
  'фактурування знову тримається за облік:\n    ' + leaks.join('\n    ') + '\n' +
  '  Вимкнути облік стало неможливо — фактури перестануть виписуватись разом\n' +
  '  із ним. Потрібне з обліку береться через його фасад або не береться.');
console.log(`  ok  ${files.length} файлів @invoicing не торкаються таблиць обліку`);

// ── Дві адреси модуля, і обидві потрібні ────────────────────────────────
//
// `index.ts` тягне варту, а варта тягне `next/server`. Сусідній модуль, який
// імпортує звідти, ламає СВОЮ перевірку під голим node — так і сталося з
// `@events`. Тому HTTP-вільний вхід існує окремо, і в ньому не має бути
// нічого, що приймає Request.
const kernel = fs.readFileSync('src/modules/invoicing/api/kernel.ts', 'utf8');
assert.ok(!/withModule|withPermission|withActor|NextResponse|NextRequest/.test(stripComments(kernel)),
  'у @invoicing/kernel зʼявилась варта або Next — тоді він перестає бути входом без HTTP');
const facade = fs.readFileSync('src/modules/invoicing/api/index.ts', 'utf8');
assert.ok(/withModule\('invoicing'/.test(facade),
  'фасад @invoicing більше не питає ключ модуля — вимкнути фактурування стало неможливо');
console.log('  ok  дві адреси: index.ts із вартою, kernel.ts без HTTP');

// ── Правила бланка не повертаються в константи ──────────────────────────
//
// `INVOICE_DUE_DAYS = 14` і `BUYER_NAME_THRESHOLD_CZK = 9900` — те, з чого
// почалось. Друга гірша: 9900 Kč це норма ОДНІЄЇ юрисдикції, а поріг у
// кронах порівнювався з сумою в будь-якій валюті.
// `stripComments` тут обовʼязковий: у документації самого файлу обидві
// константи названі як історія — і без цього перевірка ловила пояснення
// того, що вже виправлено. Той самий урок, що в currency.check.ts.
const rules = stripComments(
  fs.readFileSync('src/modules/invoicing/domain/invoice-rules.ts', 'utf8'));
assert.ok(!/INVOICE_DUE_DAYS|BUYER_NAME_THRESHOLD/.test(rules),
  'правила бланка знову константи — вони мають бути в organization_invoicing');
for (const fn of ['showBuyerName', 'dueDateFor']) {
  const m = new RegExp(`export function ${fn}\\(([\\s\\S]*?)\\)`).exec(rules);
  assert.ok(m, `${fn} зник із invoice-rules`);
  assert.ok(/rules:\s*Pick<InvoiceSettings/.test(m![1]),
    `${fn} не приймає правила готелю аргументом — константу можна забути, обовʼязковий аргумент ні`);
}
console.log('  ok  строк оплати і поріг покупця — налаштування, не константи');

// ── Поріг покупця порівнюється у валюті готелю ──────────────────────────
const settings = fs.readFileSync('src/modules/invoicing/data/invoice-settings.repo.ts', 'utf8');
assert.ok(/У ВАЛЮТІ ГОТЕЛЮ/.test(settings),
  'у налаштуваннях зникла згадка, що поріг — у валюті готелю; саме цього бракувало 9900 кронам');
assert.ok(/buyerNameThreshold == null\) return true/.test(rules),
  'поріг без значення має означати «називати покупця завжди»: зайве імʼя це незручність, відсутнє — порушення');
console.log('  ok  поріг у валюті готелю, порожній = називати завжди');

console.log('  ok  @invoicing: свій бланк, свої правила, без обліку під ним');
