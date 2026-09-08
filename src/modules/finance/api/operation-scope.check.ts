/**
 * Операція одного готелю не посилається на довідник другого — НА ЗАПИСІ.
 *
 *   node src/modules/finance/api/operation-scope.check.ts
 *
 * `chart-of-accounts.check.ts` стереже сусідню половину: другий готель не
 * ДІСТАЄ статтю першого читанням. Це інша вісь, і на ній вада жила окремо
 * (Р12.3): `createOperationInTx` брав `category_id` просто з тіла запиту й
 * писав його в рядок. Так само `account_from_id`, `account_to_id`,
 * `project_id`, `counterparty_id` — пʼять полів, кожне вказує в довідник, і
 * жодне не перевірялось на належність.
 *
 * Чому цього не спиняє база. Зовнішній ключ тут ОДНОКОЛОНКОВИЙ
 * (`category_id → expense_categories(id)`), тобто він доводить, що рядок
 * існує, і мовчить про те, чий він. А RI-тригери Postgres виконуються з
 * вимкненою row security — політика, яка ховає чужий рядок від читання, при
 * перевірці ключа не працює. Тож `INSERT` із чужим ідентифікатором проходить,
 * і виходить операція, чия стаття для її ж готелю невидима: у списку —
 * порожня назва, у P&L — `COALESCE(classifier,'other')`, тобто гроші лягають
 * не в той рядок звіту. Тихо.
 *
 * Осі (інваріант 26): готелів два, і кожне твердження ставиться з ОБОХ боків
 * — своє приймається, чуже відмовляється. Одного боку мало: «відмовляє
 * завжди» виглядало б так само зелено, як «відмовляє правильно», а це вже
 * зламаний модуль фінансів.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { provisionOrganization } = await import('@core/provisioning');
const { isRefusal } = await import('@core/http/refusal');
const { createOperationInTx } = await import('./operations.handlers');

const sql = getSql();
const SLUGS = ['opscope-check-one', 'opscope-check-two'];
const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

async function cleanup() {
  // Операції ОБОХ готелів знімаються ПЕРШИМИ, до будь-яких довідників.
  // Причина — та сама вада, яку стереже цей гейт: доки вона в силі, операція
  // першого готелю посилається на статтю другого, і прибирання другого падає
  // на зовнішньому ключі. Тобто червоний гейт мусить лишати за собою чисто —
  // інакше наступний прогін почався б із чужого сміття.
  for (const slug of SLUGS) {
    const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [slug]);
    if (!org) continue;
    await runWithOrganization(org.id, () =>
      sql.run('DELETE FROM fin_operations WHERE organization_id = ?', [org.id]));
  }
  for (const slug of SLUGS) {
    const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [slug]);
    if (!org) continue;
    // У КОНТЕКСТІ ОРЕНДАРЯ: під роллю застосунку `DELETE` без контексту
    // прибирає НУЛЬ рядків і не каже про це нічого (INC-014).
    await runWithOrganization(org.id, async () => {
      await sql.run('DELETE FROM fin_operations WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM fin_auto_rules WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM finance_counterparties WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM expense_categories WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM business_units WHERE organization_id = ?', [org.id]);
      // `app_users` перед `finance_accounts`: власник тримає касу через
      // `default_cash_account_id`, і цей ключ не каскадний (Д26).
      await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM finance_accounts WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org.id]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
  }
}

/** Довідник одного готелю: стаття, каса, юніт, контрагент. */
async function catalogue(organizationId: string, tag: string) {
  return runWithOrganization(organizationId, async () => {
    const cat = await sql.row<{ id: string }>(
      "SELECT id FROM expense_categories WHERE organization_id = ? AND code = 'other_exp'", [organizationId]);
    const acc = await sql.row<{ id: string }>(
      "SELECT id FROM finance_accounts WHERE organization_id = ? AND type = 'cash'", [organizationId]);
    const unit = await sql.row<{ id: string }>(
      "SELECT id FROM business_units WHERE organization_id = ? AND code = 'shared'", [organizationId]);
    const cpId = `cp_${tag}`;
    await sql.run(
      'INSERT INTO finance_counterparties (id, organization_id, name) VALUES (?, ?, ?)',
      [cpId, organizationId, `Counterparty ${tag}`]);
    return {
      category: String(cat?.id), account: String(acc?.id), unit: String(unit?.id), counterparty: cpId,
    };
  });
}

await cleanup();
try {
  // По черзі, не `Promise.all`: заведення йде в транзакції, а на SQLite
  // транзакція одна на процес — паралельний запуск падає «cannot start a
  // transaction within a transaction».
  const provisioned = [];
  for (const [i, slug] of SLUGS.entries()) {
    provisioned.push(await provisionOrganization({
      name: `Op scope ${slug}`, slug,
      ownerEmail: `${slug}@example.test`, ownerPassword: 'check-password-1234',
      currency: i === 0 ? 'EUR' : 'CZK', language: 'uk',
    }));
  }
  const [one, two] = provisioned;
  const mine = await catalogue(one.organizationId, 'one');
  const alien = await catalogue(two.organizationId, 'two');

  say(Boolean(mine.category && mine.account && mine.unit),
    'у першого готелю є стаття, каса і юніт — без них решта тверджень беззмістовна');
  say(mine.category !== alien.category && mine.account !== alien.account,
    'довідники двох готелів — різні рядки (інакше «чужий» нічим не чужий)');

  const base = {
    op_type: 'expense' as const,
    amount: 100,
    currency: 'EUR',
    paid_at: '2026-09-08',
    account_from_id: mine.account,
    category_id: mine.category,
  };

  const write = async (input: Record<string, unknown>) => runWithOrganization(one.organizationId,
    () => createOperationInTx(one.organizationId, input as never, null));

  // ── 1. Свій довідник приймається ────────────────────────────────────────
  let ownId: string | null = null;
  try {
    ownId = await write({ ...base, project_id: mine.unit, counterparty_id: mine.counterparty });
  } catch (e) {
    say(false, `власна операція відмовлена (${(e as Error).message}) — далі «чуже відмовлено» нічого не значить`);
  }
  say(Boolean(ownId), 'операція з ВЛАСНИМИ статтею, касою, юнітом і контрагентом проходить');

  // ── 2. Чужий довідник — відмова, і рядка не зʼявляється ─────────────────
  const before = await runWithOrganization(one.organizationId, () => sql.row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM fin_operations WHERE organization_id = ?', [one.organizationId]));

  for (const [field, value] of [
    ['category_id', alien.category],
    ['account_from_id', alien.account],
    // Пʼяте поле. `requireOwnedReferences` перевіряє його з самого початку, а
    // цей гейт питав лише про чотири — тобто про `account_to_id` він не
    // стверджував нічого, і зняття варти саме з нього лишилось би зеленим.
    // Перевірка, яка не питає про поле, його не стереже (Р13.8).
    ['account_to_id', alien.account],
    ['project_id', alien.unit],
    ['counterparty_id', alien.counterparty],
  ] as const) {
    let refused = false;
    let how = 'ПРОЙШЛО';
    try {
      await write({ ...base, [field]: value });
    } catch (e) {
      refused = true;
      how = isRefusal(e) ? 'названа відмова' : `виняток не наш: ${(e as Error).message.slice(0, 60)}`;
      // Рід відмови важливий: помилка драйвера дала б 500 і текст бази
      // клієнтові (інваріант 6), а не речення, яке ми написали самі.
      if (!isRefusal(e)) refused = false;
    }
    say(refused, `${field} чужого готелю відхилено названою відмовою (${how})`);
  }

  const after = await runWithOrganization(one.organizationId, () => sql.row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM fin_operations WHERE organization_id = ?', [one.organizationId]));
  say(Number(after?.n) === Number(before?.n),
    `жодна з пʼяти відмов не лишила рядка (було ${before?.n}, стало ${after?.n})`);

  // ── 2b. Те саме на РЕДАГУВАННІ ──────────────────────────────────────────
  //
  // Білий список полів у `updateOperation` бере ті самі пʼять імен із тіла
  // запиту. Закрити лише створення означало б лишити двері поруч.
  if (ownId) {
    // Статус названо ТОЧНО, не «щось ≥400» (інваріант 5). Виміряно зі знятою
    // перевіркою: редагування віддає **200** і рядок справді переписується на
    // статтю сусіда (`still.category_id` стає чужим). Тобто на редагуванні це
    // не «спроба», а завершений запис у чужий довідник — і саме тому нижче
    // стоять два твердження: статус і сам рядок.
    let editStatus = 0;
    try {
      await runWithOrganization(one.organizationId, async () => {
        const { updateOperation } = await import('./operations.handlers');
        const res = await updateOperation({
          json: async () => ({ category_id: alien.category }),
          nextUrl: new URL('http://local/api/finance/operations'),
        } as never, { params: Promise.resolve({ id: String(ownId) }) });
        editStatus = res.status;
      });
    } catch (e) { editStatus = isRefusal(e) ? 404 : -1; }
    say(editStatus === 404, `редагування на чужу статтю теж відхилено, і саме 404 (${editStatus})`);

    const still = await runWithOrganization(one.organizationId, () => sql.row<{ category_id: string }>(
      'SELECT category_id FROM fin_operations WHERE id = ?', [String(ownId)]));
    say(still?.category_id === mine.category,
      `стаття операції лишилась своєю (${still?.category_id})`);
  }

  // ── 2c. Авто-правило — той самий запис, інші двері ──────────────────────
  //
  // `applyRulesToOperation` виконує `UPDATE fin_operations SET category_id = ?
  // … WHERE id = ? AND organization_id = ?` ПОВЗ `createOperationInTx` і
  // `updateOperation`, тобто повз варту вище. RLS тут не сторож: політика
  // `fin_operations` дивиться на `organization_id` ОПЕРАЦІЇ, а не на власника
  // статті, тож вада жива й на Postgres — і вона автоматизована, бо правило
  // зберігається раз, а спрацьовує на кожній наступній операції.
  //
  // Варта стоїть на ЗБЕРЕЖЕННІ: правило з чужим id не має лягти в базу взагалі.
  const { createAutoRule } = await import('./auto-rules.handlers');
  const saveRule = (actions: Record<string, unknown>) => runWithOrganization(one.organizationId,
    async () => {
      const res = await createAutoRule({
        json: async () => ({
          name: 'правило з чужою статтею', op_type: 'expense',
          conditions: [{ field: 'comment', op: 'contains', value: 'оренда' }],
          actions,
        }),
        nextUrl: new URL('http://local/api/finance/auto-rules'),
      } as never);
      return res.status;
    });

  for (const [field, value, what] of [
    ['set_category_id', alien.category, 'статтю'],
    ['set_project_id', alien.unit, 'бізнес-юніт'],
    ['set_counterparty_id', alien.counterparty, 'контрагента'],
  ] as const) {
    let status = 0;
    try { status = await saveRule({ [field]: value }); } catch (e) { status = isRefusal(e) ? 404 : -1; }
    say(status === 404, `правило з посиланням на чужий ${what} (${field}) відхилено, і саме 404 (${status})`);
  }

  const rulesLeft = await runWithOrganization(one.organizationId, () => sql.row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM fin_auto_rules WHERE organization_id = ?', [one.organizationId]));
  say(Number(rulesLeft?.n) === 0,
    `жодна з трьох відмов не лишила правила в базі (${rulesLeft?.n})`);

  // Своє посилання правило приймає — інакше «відмовляє завжди» виглядало б
  // так само зелено, як «відмовляє правильно».
  let ownRuleStatus = 0;
  try { ownRuleStatus = await saveRule({ set_category_id: mine.category }); } catch { ownRuleStatus = -1; }
  say(ownRuleStatus === 201, `правило з ВЛАСНОЮ статтею зберігається (${ownRuleStatus})`);

  // ── 2d. Правило, яке ВЖЕ лежить у базі з чужим посиланням ───────────────
  //
  // Варта на збереженні його не прибирає за побудовою: воно лягло раніше за
  // неї. Питання лише в тому, що робить СПРАЦЮВАННЯ. Мовчазного пропуску тут
  // не буває в жодному разі: або правило змінює операцію, або воно позначене
  // зламаним і готель бачить, ЯКЕ поле — не рядок у логу контейнера, який
  // ніхто не читає.
  //
  // Засівається повз API, бо саме так воно й потрапило б у базу.
  if (ownId) {
    const brokenRuleId = 'ar_broken_check';
    await runWithOrganization(one.organizationId, () => sql.run(
      `INSERT INTO fin_auto_rules
         (id, organization_id, name, op_type, conditions_json, actions_json, is_active, sort_order)
       VALUES (?, ?, ?, 'expense', ?, ?, TRUE, 100)`,
      [brokenRuleId, one.organizationId, 'Старе правило з чужою статтею',
        JSON.stringify([{ field: 'comment', op: 'contains', value: '' }]),
        JSON.stringify({ set_category_id: alien.category })]));

    const { loadActiveRules, applyRulesToOperation } = await import('../data/auto-rules-engine');
    const before = await runWithOrganization(one.organizationId, () => sql.row<{ category_id: string }>(
      'SELECT category_id FROM fin_operations WHERE id = ?', [String(ownId)]));

    await runWithOrganization(one.organizationId, async () => {
      const op = await sql.row<any>('SELECT * FROM fin_operations WHERE id = ?', [String(ownId)]);
      const rules = await loadActiveRules(one.organizationId);
      await applyRulesToOperation(op, rules, one.organizationId);
    });

    const after = await runWithOrganization(one.organizationId, () => sql.row<{ category_id: string }>(
      'SELECT category_id FROM fin_operations WHERE id = ?', [String(ownId)]));
    say(after?.category_id === before?.category_id && after?.category_id === mine.category,
      `спрацювання зламаного правила операцію НЕ змінило (${after?.category_id})`);

    const marked = await runWithOrganization(one.organizationId, () => sql.row<{ broken_fields: string }>(
      'SELECT broken_fields FROM fin_auto_rules WHERE id = ?', [brokenRuleId]));
    say(Boolean(marked?.broken_fields && marked.broken_fields.includes('set_category_id')),
      `правило позначене зламаним, із назвою поля (${marked?.broken_fields ?? 'нічого'})`);

    // І оператор бачить це в списку правил, а не тільки в базі.
    const { listAutoRules } = await import('./auto-rules.handlers');
    const listed = await runWithOrganization(one.organizationId, async () => {
      const res = await listAutoRules({ nextUrl: new URL('http://local/api/finance/auto-rules') } as never);
      return await res.json() as { id: string; broken_fields?: string[] }[];
    });
    const shown = listed.find((r) => r.id === brokenRuleId);
    say(Array.isArray(shown?.broken_fields) && shown.broken_fields.includes('set_category_id'),
      `список правил віддає ознаку зламаності оператору (${JSON.stringify(shown?.broken_fields)})`);
  }

  // ── 3. І з другого боку: другий готель не пише в довідник першого ───────
  let secondRefused = false;
  try {
    await runWithOrganization(two.organizationId, () => createOperationInTx(two.organizationId, {
      op_type: 'expense', amount: 100, currency: 'CZK', paid_at: '2026-09-08',
      account_from_id: alien.account, category_id: mine.category,
    } as never, null));
  } catch (e) { secondRefused = isRefusal(e); }
  say(secondRefused, 'другий готель так само не проводить витрату на статтю першого');
} finally {
  await cleanup();
}

if (fails.length) {
  console.log(`\noperation-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log('operation-scope: операція посилається лише на довідник СВОГО готелю — перевірено на записі, з обох боків');
assert.ok(true);
