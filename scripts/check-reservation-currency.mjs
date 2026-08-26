/**
 * INSERT у таблицю з грошима, у якому не названо валюту.
 *
 *   node scripts/check-reservation-currency.mjs [--strict]
 *
 * Схема дає кожній грошовій таблиці колонковий дефолт:
 *
 *   "currency" text NOT NULL DEFAULT 'CZK'
 *
 * Це валюта ПЕРШОГО клієнта, зашита в схему. INSERT, який колонку не називає,
 * мовчки бере її — і на цьому німецький готель (`organizations.default_currency`
 * = 'EUR') отримав бронь у кронах. Помилка не падає й нічого не пише в логи:
 * запис проходить, число правильне, знак чужий.
 *
 * Далі це значення розходиться далеко:
 *
 *   • гостьова сторінка показує `reservation.currency` («200 CZK» гостю,
 *     який домовлявся про 200 EUR);
 *   • `folio.resolveCurrency()` дивиться на бронь ПЕРШОЮ, тож наступна
 *     фактура виписується в кронах;
 *   • список послуг, кошик і лист про покинутий кошик показують
 *     `additional_services.currency`.
 *
 * Тому: називайте колонку. З сесії — валюта організації, прочитана явно (і
 * порожня організація ВІДМОВЛЯЄ, а не підставляє свою — див.
 * `folio.repo.ts:resolveCurrency`). Там, де сесії немає (вебхук, синк каналу,
 * гостьовий шлях), — підзапитом від обʼєкта, на якому рядок висить:
 *
 *   VALUES (…, (SELECT default_currency FROM organizations WHERE id = ?), …)
 *
 * Обидві колонки NOT NULL, тож підзапит без рядка валить INSERT — це і
 * потрібно: відмова замість вгаданої валюти.
 *
 * Які таблиці рахуються — читається з `db/postgres/schema.sql`: будь-яка з
 * колонкою `currency`, що має DEFAULT. Списку підтримувати не треба.
 */
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');

// ── Які таблиці мають валюту з дефолтом ─────────────────────────────────────
const SCHEMA = 'db/postgres/schema.sql';
const withCurrencyDefault = new Set();
{
  let table = null;
  for (const line of fs.readFileSync(SCHEMA, 'utf8').split('\n')) {
    const open = line.match(/^CREATE TABLE "([^"]+)" \($/);
    if (open) { table = open[1]; continue; }
    if (!table) continue;
    if (line.startsWith(')')) { table = null; continue; }
    if (/^\s+"currency"\s.*\bDEFAULT\b/i.test(line)) withCurrencyDefault.add(table);
  }
}

// ── Де шукати ───────────────────────────────────────────────────────────────
const ROOTS = ['src/modules', 'src/core', 'src/app'];

/**
 * Файли, яким можна вставляти без валюти.
 *
 * `src/lib/db.ts` перебудовує таблиці всередині міграцій, копіюючи фіксований
 * список колонок зі старої форми в нову; там ідеться про схему, яка передує
 * колонці, і дописати її було б неправильно.
 */
const ALLOWED = new Set(['src/lib/db.ts']);

const files = [];
for (const root of ROOTS) walk(root);

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.includes('.check.')) files.push(full);
  }
}

const findings = [];

for (const file of files) {
  if (ALLOWED.has(file)) continue;
  const source = fs.readFileSync(file, 'utf8');

  const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?(\w+)"?\s*\(([^)]*)\)/gis;
  for (const m of source.matchAll(re)) {
    const [, table, columns] = m;
    if (!withCurrencyDefault.has(table)) continue;
    if (/\bcurrency\b/.test(columns)) continue;

    findings.push({
      file,
      line: source.slice(0, m.index).split('\n').length,
      table,
    });
  }
}

// ── Літерали валюти першого клієнта там, де їх бачить гість ─────────────────
//
// Другий бік тієї самої помилки: колонку назвали, а поруч у коді лишився
// `|| 'CZK'` чи `|| 'Kč'`. Гість читає саме його.
const GUEST_FACING = ['src/app/guest', 'src/modules/guests', 'src/modules/widget/ui'];
const literals = [];
for (const file of files) {
  if (!GUEST_FACING.some((p) => file.startsWith(p))) continue;
  const source = fs.readFileSync(file, 'utf8');
  source.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|--)/.test(line)) return;   // коментар — не код
    if (/\|\|\s*'(CZK|Kč)'/.test(line) || /\|\|\s*"(CZK|Kč)"/.test(line)) {
      literals.push({ file, line: i + 1, text: line.trim().slice(0, 90) });
    }
  });
}

// ── Звіт ────────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('ВАЛЮТА, ЯКУ НЕ НАЗВАНО — має бути нуль');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('');

if (findings.length === 0 && literals.length === 0) {
  console.log(`  чисто — ${files.length} файлів, ${withCurrencyDefault.size} таблиць із DEFAULT на currency`);
  console.log('');
  process.exit(0);
}

for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  →  INSERT INTO ${f.table} без currency`);
}
for (const l of literals) {
  console.log(`  ${l.file}:${l.line}  →  валюта першого клієнта в тексті для гостя: ${l.text}`);
}
console.log('');
console.log(`  разом: ${findings.length + literals.length}`);
console.log('');
console.log("  DEFAULT на колонці — це 'CZK', валюта першого клієнта. Назвіть колонку:");
console.log('  валюта організації з сесії (порожня — відмовити, а не вгадати), або');
console.log('  (SELECT default_currency FROM organizations WHERE id = ?) там, де сесії немає.');
console.log('');

process.exit(strict ? 1 : 0);
