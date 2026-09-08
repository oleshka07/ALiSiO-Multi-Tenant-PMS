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

const sql = getSql();
const rnd = () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2, 10);

/** Скільки з довідника вже є — рахується В КОНТЕКСТІ ОРЕНДАРЯ (INC-014). */
async function state(org) {
  return runWithOrganization(org.id, async () => {
    const ec = await sql.rows(
      'SELECT code FROM expense_categories WHERE organization_id = ? AND code IS NOT NULL', [org.id]);
    const bu = await sql.rows(
      'SELECT code FROM business_units WHERE organization_id = ? AND code IS NOT NULL', [org.id]);
    return { ec: new Set(ec.map((r) => r.code)), bu: new Set(bu.map((r) => r.code)) };
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
  console.log('\n  готель                     валюта   статей   юнітів');
  for (const org of orgs) {
    const s = await state(org);
    const mark = (s.ec.size === CHART_OF_ACCOUNTS.length && s.bu.size === BUSINESS_UNITS.length) ? ' ' : '←';
    console.log(`  ${String(org.slug).padEnd(26)} ${String(org.default_currency).padEnd(8)} `
      + `${String(s.ec.size).padStart(2)}/${CHART_OF_ACCOUNTS.length}    `
      + `${String(s.bu.size).padStart(2)}/${BUSINESS_UNITS.length}  ${mark}`);
  }
  console.log('\n  ← бракує довідника; засіяти: --slug <готель> або --all\n');
  process.exit(0);
}

let touched = 0;
for (const org of orgs) {
  const s = await state(org);
  const missingEc = CHART_OF_ACCOUNTS.filter((a) => !s.ec.has(a.code));
  const missingBu = BUSINESS_UNITS.filter((u) => !s.bu.has(u.code));
  if (missingEc.length === 0 && missingBu.length === 0) {
    console.log(`  ${org.slug}: довідник повний, нічого не робив`);
    continue;
  }
  // Писати теж у контексті орендаря: на Postgres політика перевіряє КОЖЕН
  // рядок при вставці (WITH CHECK), і без контексту вставка відхиляється.
  await runWithOrganization(org.id, async () => {
    for (const a of missingEc) {
      await sql.run(
        `INSERT INTO expense_categories (id, organization_id, code, name, std_group, pnl_line,
           include_in_pnl, include_in_cash, alloc_method, is_capex, icon, color, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`ec_${rnd()}`, org.id, a.code, a.name, a.stdGroup, a.pnlLine,
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
  console.log(`  ${org.slug}: додано ${missingEc.length} стат(тю/ей) і ${missingBu.length} бізнес-юніт(и/ів)`);
  touched += 1;
}

console.log(touched > 0
  ? `\nготово: ${touched} готел(ь/і/ів) отримали довідник\n`
  : '\nнічого робити не довелось — довідник повний у всіх\n');
