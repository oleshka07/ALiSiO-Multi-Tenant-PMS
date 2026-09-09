/**
 * Шаблон і бюджет доводять належність НА ЗБЕРЕЖЕННІ, а відмову рушія видно.
 *
 *   node src/modules/finance/api/recurring-scope.check.ts
 *
 * Дві половини однієї вади (Р13.7).
 *
 * ПЕРША. `recurring.handlers.ts` і `budgets.handlers.ts` зберігали клієнтський
 * `category_id` без жодної перевірки. Це не «ще одне місце того ж роду» — це
 * місце, де помилка ВІДКЛАДЕНА: шаблон лягає в базу тихо, а відмовляє аж
 * `createOperationInTx`, коли рушій дійде до нього вночі. Оператор при цьому
 * давно пішов додому.
 *
 * ДРУГА, гірша. `runRecurringTick` ловив той виняток і ставив
 * `is_active = FALSE`. Тобто помилка КОНФІГУРАЦІЇ тихо вимикала готелю
 * регулярний платіж: оренда просто перестає нараховуватись, ніхто нічого не
 * бачить, а причина лежить у логу контейнера, який не читає ніхто.
 *
 * Вимкнення шаблону тепер стан, ВИДИМИЙ у списку шаблонів: `failed_runs`,
 * `last_error`, `last_error_at`. І з ПЕРШОЇ відмови шаблон не гасне — відмова
 * буває тимчасовою (курсу валют ще немає на сьогодні), а погашений шаблон не
 * вмикається сам.
 *
 * Осі (інваріант 26): два готелі з РІЗНИМИ статтями, і три різні стани
 * шаблону — перша відмова, друга, третя. З однією відмовою «не гасне з першої»
 * і «не гасне ніколи» невідрізненні.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { provisionOrganization } = await import('@core/provisioning');
const { createRecurringTemplate } = await import('./recurring.handlers');
const { upsertBudget } = await import('./budgets.handlers');
const { runRecurringTick } = await import('../data/recurring-engine');

const sql = getSql();
const SLUGS = ['rectpl-check-one', 'rectpl-check-two'];
const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

async function cleanup() {
  for (const slug of SLUGS) {
    const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [slug]);
    if (!org) continue;
    await runWithOrganization(org.id, async () => {
      await sql.run('DELETE FROM fin_operations WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM fin_budgets WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM fin_recurring_templates WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM expense_categories WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM business_units WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM finance_accounts WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org.id]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
  }
}

const catalogue = (organizationId: string) => runWithOrganization(organizationId, async () => ({
  category: String((await sql.row<{ id: string }>(
    "SELECT id FROM expense_categories WHERE organization_id = ? AND code = 'other_exp'",
    [organizationId]))?.id),
  account: String((await sql.row<{ id: string }>(
    "SELECT id FROM finance_accounts WHERE organization_id = ? AND type = 'cash'",
    [organizationId]))?.id),
}));

await cleanup();
try {
  const provisioned = [];
  for (const [i, slug] of SLUGS.entries()) {
    provisioned.push(await provisionOrganization({
      name: `Recurring scope ${slug}`, slug,
      ownerEmail: `${slug}@example.test`, ownerPassword: 'check-password-1234',
      currency: i === 0 ? 'EUR' : 'CZK', language: 'uk',
      // Шов злиття: заведення вимагає пояса (О10) і роду житла (В1) — обидва
      // названо явно. `timezone`, а не `country`: країна вирішує ще й юрисдикцію
      // документа, і підставити її тут означало б змінити те, про що ця сцена
      // не збиралась стверджувати.
      timezone: i === 0 ? 'Europe/Kyiv' : 'Europe/Prague', lodgingKind: 'hotel',
    }));
  }
  const [one, two] = provisioned;
  const mine = await catalogue(one.organizationId);
  const alien = await catalogue(two.organizationId);
  say(mine.category !== alien.category, 'статті двох готелів — різні рядки');

  const saveTemplate = (body: Record<string, unknown>) => runWithOrganization(one.organizationId,
    async () => {
      const res = await createRecurringTemplate({
        json: async () => body,
        nextUrl: new URL('http://local/api/finance/recurring'),
      } as never);
      return res.status;
    });

  const baseTemplate = {
    name: 'Оренда', op_type: 'expense', amount: 1000, currency: 'EUR',
    account_from_id: mine.account, schedule: 'monthly', next_run_at: '2026-09-20',
  };

  // ── 1. Шаблон із чужою статтею — 404 на ЗБЕРЕЖЕННІ ─────────────────────
  say(await saveTemplate({ ...baseTemplate, category_id: mine.category }) === 201,
    'шаблон із ВЛАСНОЮ статтею зберігається');
  const alienStatus = await saveTemplate({ ...baseTemplate, category_id: alien.category });
  say(alienStatus === 404, `шаблон із чужою статтею відхилено, і саме 404 (${alienStatus})`);

  const stored = await runWithOrganization(one.organizationId, () => sql.rows<any>(
    'SELECT category_id FROM fin_recurring_templates WHERE organization_id = ?', [one.organizationId]));
  say(stored.length === 1 && stored[0].category_id === mine.category,
    `у базі лишився один шаблон, і стаття в ньому своя (${stored.length})`);

  // ── 2. Бюджетний рядок — те саме тіло, ті самі двері ───────────────────
  const budgetStatus = await runWithOrganization(one.organizationId, async () => {
    const res = await upsertBudget({
      json: async () => ({ year: 2026, month: 9, category_id: alien.category, planned_amount: 500 }),
      nextUrl: new URL('http://local/api/finance/budgets'),
    } as never);
    return res.status;
  });
  say(budgetStatus === 404, `бюджет із чужою статтею відхилено, і саме 404 (${budgetStatus})`);

  const budgets = await runWithOrganization(one.organizationId, () => sql.row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM fin_budgets WHERE organization_id = ?', [one.organizationId]));
  say(Number(budgets?.n) === 0, `бюджетного рядка з чужою статтею в базі немає (${budgets?.n})`);

  // ── 3. Шаблон, що почав відмовляти ПІСЛЯ збереження ────────────────────
  //
  // Ламаємо його так, як ламається життя, і НЕ підробкою чужого id: шаблон
  // виписаний у валюті, курсу до якої готель ще не завів. `computeAmountCompany`
  // на це відмовляє названо — і це найчастіша реальна відмова рушія, бо курс
  // заводять руками. Варта на збереженні цього не ловить за побудовою: вона
  // стояла раніше, а курс зник (або не зʼявився) пізніше.
  const tplId = String((await runWithOrganization(one.organizationId, () => sql.row<{ id: string }>(
    'SELECT id FROM fin_recurring_templates WHERE organization_id = ? ORDER BY created_at LIMIT 1',
    [one.organizationId])))?.id);
  await runWithOrganization(one.organizationId, () => sql.run(
    "UPDATE fin_recurring_templates SET currency = 'USD', next_run_at = ? WHERE id = ?",
    ['2026-09-01', tplId]));

  const state = () => runWithOrganization(one.organizationId, () => sql.row<any>(
    'SELECT is_active, failed_runs, last_error FROM fin_recurring_templates WHERE id = ?', [tplId]));

  /**
   * Один строк — одна відмова.
   *
   * `runRecurringTick()` за замовчуванням дивиться на 30 днів УПЕРЕД, тож на
   * місячному шаблоні один прогін встигає впасти двічі: після першої відмови
   * `next_run_at` зсувається на наступний місяць, а той усе ще в вікні.
   * Тобто «прогін» і «відмова» — різні речі, і сцена, яка їх плутає,
   * стверджувала б про кількість прогонів, а не про поведінку. Тому вікно
   * нульове, а настання наступного строку відтворюється явно.
   */
  const failOnce = async () => {
    await runWithOrganization(one.organizationId, () => sql.run(
      "UPDATE fin_recurring_templates SET next_run_at = '2026-09-01' WHERE id = ?", [tplId]));
    await runRecurringTick(0);
  };

  await failOnce();
  const after1 = await state();
  say(Number(after1?.is_active) === 1,
    `після ПЕРШОЇ відмови шаблон ще активний (is_active=${after1?.is_active})`);
  say(Number(after1?.failed_runs) === 1, `лічильник відмов = 1 (${after1?.failed_runs})`);
  say(Boolean(after1?.last_error), `причина записана й видима готелю (${String(after1?.last_error).slice(0, 60)})`);

  await failOnce();
  const after2 = await state();
  say(Number(after2?.is_active) === 1 && Number(after2?.failed_runs) === 2,
    `після другої — теж активний, лічильник 2 (активний=${after2?.is_active}, відмов=${after2?.failed_runs})`);

  await failOnce();
  const after3 = await state();
  say(Number(after3?.is_active) === 0 && Number(after3?.failed_runs) === 3,
    `після третьої — вимкнено, і причина лишилась (активний=${after3?.is_active}, відмов=${after3?.failed_runs})`);
  say(Boolean(after3?.last_error),
    `вимкнений шаблон каже ЧОМУ (${String(after3?.last_error).slice(0, 60)})`);

  // ── 4. Успішний прогін скидає лічильник ────────────────────────────────
  //
  // Рахуються відмови ПОСПІЛЬ, а не за все життя шаблону: інакше три збої за
  // півроку погасили б шаблон, який щомісяця працює.
  await runWithOrganization(one.organizationId, () => sql.run(
    "UPDATE fin_recurring_templates SET currency = 'EUR', is_active = TRUE, next_run_at = '2026-09-01' WHERE id = ?",
    [tplId]));
  await runRecurringTick(0);
  const healed = await state();
  say(Number(healed?.failed_runs) === 0 && !healed?.last_error,
    `успішний прогін скинув лічильник і причину (відмов=${healed?.failed_runs}, причина=${healed?.last_error ?? 'немає'})`);
} finally {
  await cleanup();
}

if (fails.length) {
  console.log(`\nrecurring-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log('recurring-scope: шаблон і бюджет доводять належність на збереженні, а відмова рушія видима і не гасить з першого разу');
assert.ok(true);
