/**
 * План рахунків і бізнес-юніти для готелю, заведеного ДО переїзду засіву.
 *
 *   node scripts/seed-chart-of-accounts.mjs --list
 *   node scripts/seed-chart-of-accounts.mjs --slug penzion
 *   node scripts/seed-chart-of-accounts.mjs --all
 *
 * Навіщо окремий скрипт, а не міграція. Міграція котиться до того, як орендар
 * існує: `SELECT id FROM organizations LIMIT 1` у ній не знаходив НІЧОГО, і
 * саме тому на чистій базі довідника не діставалось нікому (INC-028, ланка 1).
 * Полагодити умову означало б лишити рід помилки на місці — сівач, що вдає
 * міграцію. Тому засів живе в `provisionOrganization`, а цей скрипт закриває
 * рівно одну діру: організації, заведені РАНІШЕ.
 *
 * І він існує тому, що інакше довелося б диктувати оператору разові команди в
 * термінал сервера (AGENTS §5): немає скрипта — спершу створюється скрипт.
 *
 * Ідемпотентний: сіє лише те, чого бракує, за сталим `code`. Повторний запуск
 * нічого не дублює і нічого не переписує — назви, які готель уже змінив під
 * себе, лишаються його.
 *
 * Друга діра, яку він закриває (Р12.1): стаття Є, але без `op_type` і
 * `classifier` — так виходило в готелів, заведених між INC-025 і цією
 * правкою. Така стаття гірша за відсутню: вона показується у довіднику,
 * приймає операції і не відмовляє нічим, а P&L кладе її в «Інше» (нижче
 * EBITDA), форма витрати не показує зовсім. Скрипт підписує осі за тим самим
 * `code` — і лише там, де порожньо.
 */
import './lib/module-aliases.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (has('--help') || (!has('--list') && !has('--all') && !val('--slug'))) {
  console.log('Потрібно: --list | --slug <slug> | --all');
  process.exit(has('--help') ? 0 : 2);
}

const { getSql } = await import('../src/core/db/async.ts');
const { runWithOrganization } = await import('../src/core/auth/tenant-context.ts');
const { CHART_OF_ACCOUNTS, BUSINESS_UNITS } = await import('../src/core/chart-of-accounts.ts');
// Фасадом `@finance`, не з `data/` напряму: цей скрипт — код ПОЗА модулем
// (разова дія адміністратора), і прямий імпорт нутрощів пробиває межу.
const { wrongAxisRows, unknownGroupRows, repairAxes } = await import('../src/modules/finance/api/index.ts');

const sql = getSql();
const rnd = () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2, 10);

/** Скільки з довідника вже є — рахується В КОНТЕКСТІ ОРЕНДАРЯ (INC-014). */
async function state(org) {
  return runWithOrganization(org.id, async () => {
    const ec = await sql.rows(
      'SELECT code, op_type, classifier FROM expense_categories WHERE organization_id = ? AND code IS NOT NULL', [org.id]);
    const bu = await sql.rows(
      'SELECT code FROM business_units WHERE organization_id = ? AND code IS NOT NULL', [org.id]);
    // Стаття з НЕПРАВИЛЬНОЮ віссю — це не «майже готова»: P&L кладе її не в
    // той рядок, а форма витрати може не показати зовсім (Р12.1). Тому вона
    // рахується окремо від відсутньої: доробити треба інакше — не вставити,
    // а підписати.
    //
    // Міра — РОЗБІЖНІСТЬ із правилом, не порожнеча (Р13.6). Доти тут стояло
    // `!r.op_type || !r.classifier`, і саме тому `--list` показував «без осей:
    // 0» на базах, яким легасі-бекфіл `db.ts` поставив непорожнє й
    // неправильне: `investors` діставав `other/other`, тобто надходження від
    // інвестора рахувалося виручкою, а звіт про це мовчав.
    const wrong = (await wrongAxisRows(org.id)).map((r) => r.code || r.name);
    const unknown = (await unknownGroupRows(org.id)).map((r) => r.code || r.name);
    return {
      ec: new Set(ec.map((r) => r.code)), bu: new Set(bu.map((r) => r.code)),
      wrong, unknown,
    };
  });
}

const orgs = await sql.rows(
  val('--slug')
    ? 'SELECT id, slug, name, default_currency FROM organizations WHERE slug = ?'
    : 'SELECT id, slug, name, default_currency FROM organizations ORDER BY slug',
  val('--slug') ? [val('--slug')] : []);

if (orgs.length === 0) {
  console.log(val('--slug') ? `готелю "${val('--slug')}" немає` : 'у базі немає жодної організації');
  process.exit(1);
}

if (has('--list')) {
  console.log('\n  готель                     валюта   статей   юнітів  хибних осей');
  const unknownSeen = [];
  for (const org of orgs) {
    const s = await state(org);
    const full = s.ec.size === CHART_OF_ACCOUNTS.length && s.bu.size === BUSINESS_UNITS.length
      && s.wrong.length === 0;
    console.log(`  ${String(org.slug).padEnd(26)} ${String(org.default_currency).padEnd(8)} `
      + `${String(s.ec.size).padStart(2)}/${CHART_OF_ACCOUNTS.length}    `
      + `${String(s.bu.size).padStart(2)}/${BUSINESS_UNITS.length}     `
      + `${String(s.wrong.length).padStart(2)}        ${full ? ' ' : '←'}`);
    // Не лише число: саме через «0» без імен ця вада й прожила стільки.
    if (s.wrong.length > 0) console.log(`      хибні: ${s.wrong.join(', ')}`);
    if (s.unknown.length > 0) unknownSeen.push([org.slug, s.unknown]);
  }
  console.log('\n  ← бракує довідника або вісь розходиться з правилом; полагодити: --slug <готель> або --all');
  console.log('  «хибних осей» — стаття є, але її вісь не та: P&L кладе гроші не в той рядок.');
  console.log('  Рахуються РОЗБІЖНОСТІ, не порожнеча: легасі-бекфіл ставив непорожнє й неправильне,');
  console.log('  і доти цей стовпчик показував нуль (Р13.6).');
  if (unknownSeen.length > 0) {
    console.log('\n  Статті, для яких правила НЕМАЄ — їх не лікують, їх треба назвати руками');
    console.log('  (група обліку не з переліку; читач П&L на них відмовляється):');
    for (const [slug, names] of unknownSeen) console.log(`    ${slug}: ${names.join(', ')}`);
  }
  console.log('');
  process.exit(0);
}

let touched = 0;
for (const org of orgs) {
  const s = await state(org);
  const missingEc = CHART_OF_ACCOUNTS.filter((a) => !s.ec.has(a.code));
  const missingBu = BUSINESS_UNITS.filter((u) => !s.bu.has(u.code));
  if (missingEc.length === 0 && missingBu.length === 0 && s.wrong.length === 0) {
    console.log(`  ${org.slug}: довідник повний, нічого не робив`);
    continue;
  }
  // Писати теж у контексті орендаря: на Postgres політика перевіряє КОЖЕН
  // рядок при вставці (WITH CHECK), і без контексту вставка відхиляється.
  await runWithOrganization(org.id, async () => {
    for (const a of missingEc) {
      await sql.run(
        `INSERT INTO expense_categories (id, organization_id, code, name, std_group, pnl_line,
           op_type, classifier,
           include_in_pnl, include_in_cash, alloc_method, is_capex, icon, color, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`ec_${rnd()}`, org.id, a.code, a.name, a.stdGroup, a.pnlLine,
          a.opType, a.classifier,
          a.includeInPnl ? 1 : 0, a.includeInCash ? 1 : 0, a.allocMethod, a.isCapex,
          a.icon, a.color, a.sortOrder]);
    }
    for (const u of missingBu) {
      await sql.run(
        `INSERT INTO business_units (id, organization_id, code, name, unit_type, is_shared, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`bu_${rnd()}`, org.id, u.code, u.name, u.unitType, u.isShared, u.sortOrder]);
    }
  });
  // Осі — ОСТАННІМИ, після вставки: щойно вставлені рядки вже правильні, а
  // полікувати треба ті, що були. Одні двері з міграцією 0120 і з гейтом
  // (`data/axis-repair.ts`), щоб правило не розійшлося втретє.
  const healed = await runWithOrganization(org.id, () => repairAxes(org.id));
  const unknown = await runWithOrganization(org.id, () => unknownGroupRows(org.id));
  console.log(`  ${org.slug}: додано ${missingEc.length} стат(тю/ей) і ${missingBu.length} бізнес-юніт(и/ів)`
    + (healed ? `, виправлено осі ще ${healed} статтям` : ''));
  if (unknown.length > 0) {
    console.log(`      НЕ полікував ${unknown.length}: група обліку не з переліку — ${unknown.map((r) => r.code || r.name).join(', ')}`);
    console.log('      Вгадана вісь це гроші в чужому рядку звіту; назвіть групу руками.');
  }
  touched += 1;
}

console.log(touched > 0
  ? `\nготово: ${touched} готел(ь/і/ів) отримали довідник\n`
  : '\nнічого робити не довелось — довідник повний у всіх\n');
