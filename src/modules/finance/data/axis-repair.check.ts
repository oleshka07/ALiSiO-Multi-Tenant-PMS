/**
 * Лікування осей бере НЕПРАВИЛЬНІ, а не лише порожні.
 *
 *   node src/modules/finance/data/axis-repair.check.ts
 *
 * Р12.1 підписував осі там, де ПОРОЖНЬО: `scripts/seed-chart-of-accounts.mjs`
 * (`blind` = немає `op_type` або `classifier`), міграція 0097, і обидва
 * бекфіли в `db.ts`. Це залишало без лікування рівно ті бази, яким гірше за
 * всіх (Р13.6): одноразовий легасі-бекфіл `db.ts` ставить осі НЕПОРОЖНІ й
 * неправильні, а після нього другий бекфіл, що лікує порожнє, не спрацьовує
 * вже ніколи — його умова `op_type IS NULL OR op_type = ''` не виконується.
 *
 * Конкретно він робив дві речі:
 *
 *   - `std_group = 'Financing'` не потрапляв у жоден його `WHEN`, тож стаття
 *     падала в останній рядок `op_type IS NULL → other/other`. Стаття
 *     `investors` — надходження від інвестора — діставала вісь «інше», і в
 *     P&L її гроші йшли НИЖЧЕ EBITDA зі знаком мінус;
 *   - `Revenue → classifier 'other'` — прямо, першим же рядком. Проживання
 *     готелю переставало бути виручкою.
 *
 * І головне: `--list` показував «без осей: 0». Не «є проблема, яку не видно»,
 * а «проблеми немає» — доповідь про безпеку від перевірки, яка дивиться не
 * туди (AGENTS §3.2).
 *
 * Порядок лікування — за `code`, і лише потім за `std_group`. Два рядки плану
 * навмисно відхиляються від своєї групи (`variable`: COGS, але «Змінні»;
 * `investors`: Financing, але надходження), і лікування самою лише групою
 * зламало б обидва.
 *
 * Осі (інваріант 26): три стани в одній фікстурі — ПОРОЖНЯ вісь, НЕПОРОЖНЯ
 * неправильна і ПРАВИЛЬНА. Без порожньої не видно, що стара умова щось таки
 * лікувала; без правильної — що лікування не переписує все підряд; без
 * неправильної не видно нічого взагалі.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { provisionOrganization } = await import('@core/provisioning');
const { expectedAxis, axisIsWrong } = await import('@core/chart-of-accounts');
const { wrongAxisRows, repairAxes } = await import('./axis-repair');

const sql = getSql();
const SLUG = 'axisrepair-check';
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

const axisOf = (organizationId: string, code: string) => runWithOrganization(organizationId,
  () => sql.row<{ op_type: string; classifier: string }>(
    'SELECT op_type, classifier FROM expense_categories WHERE organization_id = ? AND code = ?',
    [organizationId, code]));

await cleanup();
try {
  const { organizationId } = await provisionOrganization({
    name: 'Axis repair', slug: SLUG,
    ownerEmail: `${SLUG}@example.test`, ownerPassword: 'check-password-1234',
    currency: 'EUR', language: 'uk',
  });

  // ── Фікстура: база, яку пройшов легасі-бекфіл ───────────────────────────
  //
  // Значення тут не вигадані — це рівно те, що пише `db.ts:1893-1898`.
  await runWithOrganization(organizationId, async () => {
    // непорожня й неправильна: Financing не потрапив у жоден WHEN
    await sql.run("UPDATE expense_categories SET op_type = 'other', classifier = 'other' "
      + 'WHERE organization_id = ? AND code = ?', [organizationId, 'investors']);
    // непорожня й неправильна: перший рядок бекфілу, Revenue → 'other'
    await sql.run("UPDATE expense_categories SET op_type = 'income', classifier = 'other' "
      + 'WHERE organization_id = ? AND code = ?', [organizationId, 'accommodation']);
    // ПОРОЖНЯ — той стан, який стара умова таки лікувала
    await sql.run("UPDATE expense_categories SET op_type = '', classifier = '' "
      + 'WHERE organization_id = ? AND code = ?', [organizationId, 'rent']);
    // стаття самого готелю, без коду: лікується за групою
    await sql.run(
      `INSERT INTO expense_categories
         (id, organization_id, name, std_group, pnl_line, op_type, classifier, sort_order)
       VALUES (?, ?, ?, 'Financing', 'Позика', 'other', 'other', 90)`,
      [`ec_loan_${SLUG}`, organizationId, 'Позика власника']);
  });

  // ── 1. Порахувати: «без осей: 0» більше не означає «все гаразд» ─────────
  const wrong = await runWithOrganization(organizationId, () => wrongAxisRows(organizationId));
  const codes = wrong.map((r) => r.code || r.name).sort();
  say(wrong.length === 4,
    `неправильних осей знайдено 4, а не «без осей: 0» (знайдено ${wrong.length}: ${codes.join(', ')})`);
  say(codes.includes('investors') && codes.includes('accommodation'),
    'серед них НЕПОРОЖНІ й неправильні — investors і accommodation');
  say(codes.includes('rent'), 'і порожня теж — rent (старе лікування ловило лише її)');
  say(codes.includes('Позика власника'), 'і стаття готелю без коду — за групою Financing');

  // ── 2. Правильні рядки не чіпаються ────────────────────────────────────
  const variableBefore = await axisOf(organizationId, 'variable');
  say(variableBefore?.classifier === 'variable',
    `variable до лікування має власну вісь «variable», не «cogs» (${variableBefore?.classifier})`);
  say(!wrong.some((r) => r.code === 'variable'),
    'variable НЕ вважається неправильним: рядок навмисно відхиляється від групи COGS');

  // ── 3. Полікувати й перевірити кожен стан ──────────────────────────────
  const healed = await runWithOrganization(organizationId, () => repairAxes(organizationId));
  say(healed === 4, `полікувало рівно 4 рядки (${healed})`);

  const inv = await axisOf(organizationId, 'investors');
  say(inv?.op_type === 'income' && inv?.classifier === 'financing',
    `investors → income/financing (${inv?.op_type}/${inv?.classifier})`);

  const acc = await axisOf(organizationId, 'accommodation');
  say(acc?.op_type === 'income' && acc?.classifier === 'revenue',
    `accommodation → income/revenue, а не «інше» (${acc?.op_type}/${acc?.classifier})`);

  const rent = await axisOf(organizationId, 'rent');
  say(rent?.op_type === 'expense' && rent?.classifier === 'operational',
    `rent → expense/operational (${rent?.op_type}/${rent?.classifier})`);

  const loan = await runWithOrganization(organizationId, () => sql.row<any>(
    "SELECT op_type, classifier FROM expense_categories WHERE organization_id = ? AND name = 'Позика власника'",
    [organizationId]));
  say(loan?.op_type === 'income' && loan?.classifier === 'financing',
    `стаття готелю за групою Financing → income/financing (${loan?.op_type}/${loan?.classifier})`);

  const variableAfter = await axisOf(organizationId, 'variable');
  say(variableAfter?.classifier === 'variable',
    `variable після лікування ЛИШИВСЯ «variable» — лікування за кодом, не за групою (${variableAfter?.classifier})`);

  // ── 4. Ідемпотентність: другий прогін нічого не робить ─────────────────
  const again = await runWithOrganization(organizationId, () => repairAxes(organizationId));
  say(again === 0, `повторне лікування не чіпає нічого (${again})`);

  const left = await runWithOrganization(organizationId, () => wrongAxisRows(organizationId));
  say(left.length === 0, `неправильних не лишилось (${left.length})`);

  // ── 5. Невідома група не вгадується ─────────────────────────────────────
  say(expectedAxis(null, 'Вигадана') === null,
    'для невідомої групи правила НЕМАЄ — вісь не вгадується');
  say(!axisIsWrong({ code: null, std_group: 'Вигадана', op_type: 'other', classifier: 'other' }),
    'стаття з невідомою групою не рахується «неправильною» — її називає читач звіту, а не лікує сівач');
} finally {
  await cleanup();
}

if (fails.length) {
  console.log(`\naxis-repair: ${fails.length} червоних`);
  process.exit(1);
}
console.log('axis-repair: лікуються НЕПРАВИЛЬНІ осі, за кодом і лише потім за групою; правильні не чіпаються');
assert.ok(true);
