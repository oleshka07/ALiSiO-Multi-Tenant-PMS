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
 * Осі (інваріант 26). Три статті з РІЗНИМИ сумами, які не збігаються ні
 * попарно, ні в сумі з жодною іншою комбінацією: 7000 (фінансування), 500
 * (оренда, OPEX) і 300 (виручка). Одна сума не розрізнила б «потрапило в
 * секцію» і «потрапило в сусідню»; однакові — не розрізнили б, котра з них.
 */
import assert from 'node:assert';
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

await cleanup();
try {
  const { organizationId } = await provisionOrganization({
    name: 'PnL classifier', slug: SLUG,
    ownerEmail: `${SLUG}@example.test`, ownerPassword: 'check-password-1234',
    currency: 'EUR', language: 'uk',
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
