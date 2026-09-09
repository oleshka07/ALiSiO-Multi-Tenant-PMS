/**
 * Стаття без осі не падає мовчки в «Інше» — читач П&L один на всі місця.
 *
 *   node src/modules/finance/api/pnl-classifier.check.ts
 *
 * Р12.1 закрив ПРИЧИНУ (стаття отримує `op_type` і `classifier` від засіву), і
 * саме тому Р13.4 було непомітно: усі фікстури тепер сіються з осями, тож
 * жоден гейт не бачив, що ЧИТАЧА не полагодили. `reports.handlers.ts` брав
 * `COALESCE(ec.classifier, 'other')` (`:402`) і `r.classifier || 'other'`
 * (`:458`), тоді як правильний читач із падінням на `std_group` уже лежав
 * поруч — `money-metrics.ts` (`CLS_SQL`). Ліки були написані й не застосовані.
 *
 * Що це коштує в грошах. Стаття `investors` має `std_group = 'Financing'`, і
 * саме її отримує готель, заведений до Р12.1, або будь-який, кому легасі-бекфіл
 * поставив порожню вісь. Із «Інше» надходження від інвестора стає рядком
 * НИЖЧЕ EBITDA, у секції витрат зі знаком мінус, — тобто внесок власника
 * зменшує чистий результат, замість того щоб стояти окремим рядком
 * «Фінансові (надходження)». Помилки не буває ніде: звіт будується, числа
 * правдоподібні.
 *
 * Друга сцена — про мовчання. Стаття зі `std_group`, якого немає в жодному
 * `WHEN`, не має тихо ставати «Іншим»: «не знаю, куди це» і «це інше» —
 * різні твердження, і перше мусить бути НАЗВАНЕ (інваріант 13). Готель почує
 * назву статті й полагодить її, а не шукатиме, звідки в «Іншому» шість тисяч.
 *
 * Осі (інваріант 26). Чотири статті з РІЗНИМИ сумами, які не збігаються ні
 * попарно, ні в сумі з жодною іншою комбінацією: 7000 (фінансування), 1100
 * (повернення позики), 500 (оренда, OPEX) і 300 (виручка). Одна сума не
 * розрізнила б «потрапило в секцію» і «потрапило в сусідню»; однакові — не
 * розрізнили б, котра з них.
 *
 * ── Чому тут ЩЕ Й статичне твердження (Р14.1) ───────────────────────────────
 *
 * Сцени нижче стверджують про поведінку ОДНОГО читача, і цього виявилось мало:
 * «один читач на обидва місця» було виконано в одному місці з чотирьох. Гейт
 * тримав ВИРАЗ (`CLS_SQL`), а не властивість, тому сусідні читачі — живий
 * екран «PNL-2», кешфлоу, розклад по бізнес-юнітах — і ПИСАЧ дочірньої статті
 * лишились кожен зі своїм мовчазним дефолтом, і гейт був зелений.
 *
 * Тому першим стоїть твердження про весь модуль: дефолту осі поза
 * `money-metrics.ts` немає жодного. Червоність доводиться поверненням
 * `'other'` у `pnl2` (SQL-вісь) і `|| 'other'` у писачі (вісь виразу).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { provisionOrganization } = await import('@core/provisioning');
const { isRefusal } = await import('@core/http/refusal');
const { createOperationInTx } = await import('./operations.handlers');
const { getPnlMatrix } = await import('./reports.handlers');

const sql = getSql();
const SLUG = 'pnlcls-check';
const MONTH = '2026-07';
const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

async function cleanup() {
  const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [SLUG]);
  if (!org) return;
  await runWithOrganization(org.id, async () => {
    await sql.run('DELETE FROM fin_operations WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM expense_categories WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM business_units WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM finance_accounts WHERE organization_id = ?', [org.id]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org.id]);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
}

/** Звіт П&L за один місяць, розкладений по ключах секцій. */
async function pnl(organizationId: string): Promise<{
  status: number; totals: Record<string, number>; refusal: string | null;
}> {
  return runWithOrganization(organizationId, async () => {
    try {
      const res = await getPnlMatrix({
        url: `http://local/api/finance/reports/pnl?from=${MONTH}&to=${MONTH}&basis=paid`,
      } as never);
      // Названа відмова доходить ТІЛОМ відповіді, не винятком: `handleError`
      // ловить її всередині хендлера й віддає своїм статусом. Гейт, який
      // чекав би лише на `throw`, побачив би 400 і порожній текст — тобто не
      // відрізнив би названу відмову від будь-якої іншої чотирисотки.
      const body = await res.json() as { sections?: { key: string; total: number }[]; error?: string };
      const totals: Record<string, number> = {};
      for (const s of body.sections || []) totals[s.key] = s.total;
      return { status: res.status, totals, refusal: body.error ?? null };
    } catch (e) {
      return {
        status: isRefusal(e) ? 400 : -1, totals: {},
        refusal: isRefusal(e) ? (e as Error).message : `виняток не наш: ${(e as Error).message.slice(0, 70)}`,
      };
    }
  });
}

// ── 0. ВЛАСТИВІСТЬ: у модулі немає другого правила осі ──────────────────────
//
// Сцени нижче стверджують про ПОВЕДІНКУ одного читача. Цього виявилось мало:
// Р13.4 просив «один читач на обидва місця», і місць було чотири — `CLS_SQL`
// полагодив `getPnlMatrix`, а живий екран «PNL-2», кешфлоу, розклад по
// бізнес-юнітах і ПИСАЧ дочірньої статті лишились кожен зі своїм мовчазним
// дефолтом. Гейт про вираз їх не бачив за побудовою: він тримав ВИРАЗ, а не
// властивість (Р14.1, AGENTS §3.2.1).
//
// Тому твердження тут інше: **у `src/modules/finance/**` немає жодного
// дефолту осі поза `data/money-metrics.ts`**. Один дім на правило; нове місце
// або кличе його, або червоніє.
//
// Розбір — AST, не грепом. Причина названа в Р14.2: стрипер коментарів це
// окремий рід вади (він уже зʼїдав 60 рядків у `check-bare-node`), а тут його
// просто немає — коментарі JS не є вузлами-рядками й у розбір не потрапляють.
// Коментар SQL усередині шаблона вирізається окремо: `--` до кінця рядка.
const FINANCE_ROOT = path.resolve(import.meta.dirname, '..');
const AXIS_HOME = path.join(FINANCE_ROOT, 'data', 'money-metrics.ts');
// Регулярка, а не рядок: літерал усередині цього файла сам потрапив би під
// власне твердження. Регулярний вираз вузлом-рядком не є.
const SQL_DEFAULT = /COALESCE\s*\([^()]*\bclassifier\b[^()]*,[^()]*'[^']*'\s*\)/i;
const SQL_COMMENT = /--[^\n]*/g;

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) tsFiles(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const axisDefaults: string[] = [];
for (const file of tsFiles(FINANCE_ROOT)) {
  if (file === AXIS_HOME) continue;
  const text = fs.readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const at = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
  const rel = path.relative(FINANCE_ROOT, file);

  const visit = (node: ts.Node): void => {
    // 1. SQL: COALESCE(<…classifier…>, '<літерал>')
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const body = String((node as { text: string }).text).replace(SQL_COMMENT, ' ');
      if (SQL_DEFAULT.test(body)) axisDefaults.push(`${rel}:${at(node)} — SQL-дефолт осі`);
    }
    // 2. JS: <…>.classifier || '<літерал>' та `?? '<літерал>'`
    if (ts.isBinaryExpression(node)
      && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      && /\bclassifier\b/.test(node.left.getText(src))
      && ts.isStringLiteral(node.right)) {
      axisDefaults.push(`${rel}:${at(node)} — дефолт осі у виразі`);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

say(axisDefaults.length === 0,
  `дефолтів осі поза money-metrics.ts: ${axisDefaults.length}`
  + (axisDefaults.length ? `\n         ${axisDefaults.join('\n         ')}` : ''));

await cleanup();
try {
  const { organizationId } = await provisionOrganization({
    name: 'PnL classifier', slug: SLUG,
    ownerEmail: `${SLUG}@example.test`, ownerPassword: 'check-password-1234',
    currency: 'EUR', language: 'uk',
    // Шов злиття: заведення вимагає пояса (О10) і роду житла (В1) — обидва
    // названо явно. `timezone`, а не `country`: країна вирішує ще й юрисдикцію
    // документа, і підставити її тут означало б змінити те, про що ця сцена
    // не збиралась стверджувати.
    timezone: 'Europe/Kyiv', lodgingKind: 'hotel',
  });

  const account = await runWithOrganization(organizationId, () => sql.row<{ id: string }>(
    "SELECT id FROM finance_accounts WHERE organization_id = ? AND type = 'cash'", [organizationId]));

  /** Стаття З ПОРОЖНЬОЮ віссю — саме те, що лишає по собі легасі-бекфіл. */
  async function blindCategory(code: string, stdGroup: string, opType: string) {
    const id = `ec_${code}_${SLUG}`;
    await runWithOrganization(organizationId, () => sql.run(
      `INSERT INTO expense_categories
         (id, organization_id, code, name, std_group, pnl_line, op_type, classifier, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', 99)`,
      [id, organizationId, code, `Стаття ${code}`, stdGroup, `Стаття ${code}`, opType]));
    return id;
  }

  const financing = await blindCategory('fin_blind', 'Financing', 'income');
  const opex = await blindCategory('opex_blind', 'OPEX', 'expense');
  const revenue = await blindCategory('rev_blind', 'Revenue', 'income');

  const put = (input: Record<string, unknown>) => runWithOrganization(organizationId,
    () => createOperationInTx(organizationId, input as never, null));

  // Суми навмисно несумісні: 7000 ≠ 500 ≠ 300, і жодна пара не дає третьої.
  await put({ op_type: 'income', amount: 7000, currency: 'EUR', paid_at: `${MONTH}-10`,
    account_to_id: account?.id, category_id: financing });
  await put({ op_type: 'expense', amount: 500, currency: 'EUR', paid_at: `${MONTH}-11`,
    account_from_id: account?.id, category_id: opex });
  await put({ op_type: 'income', amount: 300, currency: 'EUR', paid_at: `${MONTH}-12`,
    account_to_id: account?.id, category_id: revenue });

  const r = await pnl(organizationId);
  say(r.status === 200, `звіт будується (${r.status}${r.refusal ? `: ${r.refusal}` : ''})`);

  // ── Сцена 1. Порожній classifier + std_group = 'Financing' ──────────────
  say(r.totals.financing_in === 7000,
    `надходження фінансування стоїть у своєму рядку: 7000 (у звіті ${r.totals.financing_in})`);
  say(r.totals.other === 0,
    `«Інше» порожнє — 7000 туди НЕ впало (у звіті ${r.totals.other})`);
  say(r.totals.revenue === 300,
    `виручка — це 300, а не 7300: внесок інвестора не виручка (у звіті ${r.totals.revenue})`);
  say(r.totals.operational === 500,
    `оренда з порожньою віссю впала в «Операційні»: 500 (у звіті ${r.totals.operational})`);
  say(r.totals.ebitda === -200,
    `EBITDA = 300 − 500 = −200, а не 6800 (у звіті ${r.totals.ebitda})`);

  // ── Сцена 1b. Той самий рядок на СУСІДНЬОМУ екрані — «PNL-2» ────────────
  //
  // Статична властивість вище каже, що дефолту осі в модулі немає. Вона не
  // каже, що читач кладе гроші в правильний рядок: файл без дефолту може
  // мати вісь і не використовувати її. Тому — число у звіті, як і в сцені 1.
  //
  // Витрата, а не надходження: у «PNL-2» вісь читає `mapExpense`, і саме там
  // жила вада — стаття групи `Financing` із порожнім `classifier` падала в
  // «Постоянные расходы → Прочие» замість «Кредиты».
  const unit = await runWithOrganization(organizationId, () => sql.row<{ id: string }>(
    "SELECT id FROM business_units WHERE organization_id = ? AND is_shared = FALSE LIMIT 1",
    [organizationId]));
  await put({ op_type: 'expense', amount: 1100, currency: 'EUR', paid_at: `${MONTH}-14`,
    account_from_id: account?.id, category_id: financing, project_id: unit?.id });

  const pnl2 = await runWithOrganization(organizationId, async () => {
    const { getPnl2 } = await import('./reports.pnl2');
    const res = await getPnl2({ url: `http://local/api/finance/pnl-2?month=${MONTH}` } as never);
    const body = await res.json() as { rows?: { key: string; total: number }[]; error?: string };
    const byKey: Record<string, number> = {};
    for (const r of body.rows || []) byKey[r.key] = r.total;
    return { status: res.status, byKey, error: body.error ?? null };
  });

  say(pnl2.status === 200, `«PNL-2» будується (${pnl2.status}${pnl2.error ? `: ${pnl2.error}` : ''})`);
  say(pnl2.byKey.loans === 1100,
    `повернення позики стоїть у «Кредиты»: 1100 (у звіті ${pnl2.byKey.loans})`);
  // Не «нуль»: у «Постоянных» законно лежить оренда зі сцени 1. Число
  // несумісне з альтернативним прочитанням — 500 проти 1600 (інваріант 26).
  say(pnl2.byKey.fixed === 500,
    `«Постоянные расходы» лишились орендою 500, а не 1600 (у звіті ${pnl2.byKey.fixed})`);

  // ── Сцена 2. std_group, якого немає в жодному WHEN ──────────────────────
  const unknown = await blindCategory('mystery', 'Вигадана група', 'expense');
  await put({ op_type: 'expense', amount: 900, currency: 'EUR', paid_at: `${MONTH}-13`,
    account_from_id: account?.id, category_id: unknown });

  const r2 = await pnl(organizationId);
  say(r2.status === 400 && Boolean(r2.refusal),
    `стаття з невідомою групою дає НАЗВАНУ відмову, а не мовчазне «Інше» (${r2.status}: ${r2.refusal ?? '—'})`);
  say(Boolean(r2.refusal && r2.refusal.includes('mystery')),
    `у відмові названо саме ту статтю (${r2.refusal ?? '—'})`);
  say(r2.totals.other === undefined || r2.totals.other === 0,
    `900 не осіли в «Іншому» тихо (${r2.totals.other ?? 'звіту немає'})`);
} finally {
  await cleanup();
}

if (fails.length) {
  console.log(`\npnl-classifier: ${fails.length} червоних`);
  process.exit(1);
}
console.log('pnl-classifier: вісь читається з classifier із падінням на std_group, а невідома група названа');
assert.ok(true);
