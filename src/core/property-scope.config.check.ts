/**
 * Новий рядок конфігурації в рахунку з ОДНИМ обʼєктом лягає на весь рахунок
 * (INC-038, Д54).
 *
 *   node src/core/property-scope.config.check.ts
 *
 * ── Що ламається ────────────────────────────────────────────────────────
 *
 * Провайдер області навмисно робить єдиний обʼєкт областю («обирати нема з
 * чого», `resolveScope`), тож готель з одним будинком шле `property_id=<його
 * id>` на КОЖНОМУ екрані. Якби писач конфігурації брав це значення дослівно,
 * ставки ПДВ прив'язались би до будинку — і кожен документ БЕЗ обʼєкта
 * (рахунок компанії, подія: `fin_folios.property_id` нульовий за побудовою)
 * лишився б без ставок. Виписування відмовляло б названою відмовою рівно там,
 * де оператор щойно все налаштував.
 *
 * Тобто вада не в тому, що рядок «не того будинку», а в тому, що ЧИТАЧ БЕЗ
 * БУДИНКУ не знаходить нічого. Вона гучна (названа відмова, не тихе число), і
 * саме тому її легко завести: на екрані все виглядає збереженим.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Вирішальна вісь — КІЛЬКІСТЬ обʼєктів у рахунку: 1 і 2. З одним рахунком у
 * фікстурі твердження було б зелене і на коді, який просто завжди повертає
 * `null`, і на коді, який завжди повертає id.
 *
 * Друга вісь — рід області: «один обʼєкт» проти «усі». Для «усіх» відповідь
 * `null` в обох рахунках, і це та половина, яка не сміє зрушити.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-config-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { configPropertyId, oneProperty, ALL_PROPERTIES } = await import('./property-scope.ts');

const sql = getSql();

const ONE = '__cfg_org_one';
const TWO = '__cfg_org_two';
const P_ONLY = '__cfg_p_only';
const P_A = '__cfg_p_a';
const P_B = '__cfg_p_b';

await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ONE, 'One House', 'cfg-one']);
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [TWO, 'Two Houses', 'cfg-two']);
await runWithOrganization(ONE, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
    [P_ONLY, ONE, 'Only', 'only']);
});
await runWithOrganization(TWO, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
    [P_A, TWO, 'House A', 'house-a']);
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
    [P_B, TWO, 'House B', 'house-b']);
});

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const single = await runWithOrganization(ONE, () => configPropertyId(oneProperty(P_ONLY)));
say(single === null,
  `рахунок з одним обʼєктом: новий рядок на весь рахунок, отримали ${JSON.stringify(single)}`);

const houseA = await runWithOrganization(TWO, () => configPropertyId(oneProperty(P_A)));
say(houseA === P_A,
  `рахунок із двома: рядок належить обраному будинку, отримали ${JSON.stringify(houseA)}`);

const houseB = await runWithOrganization(TWO, () => configPropertyId(oneProperty(P_B)));
say(houseB === P_B && houseB !== houseA,
  'і другому будинку — свій, а не той самий');

// «Усі обʼєкти» — спільний рядок в обох рахунках. Ця половина не сміє зрушити:
// саме нею оператор заводить ставку на весь рахунок при двох будинках.
const allOne = await runWithOrganization(ONE, () => configPropertyId(ALL_PROPERTIES));
const allTwo = await runWithOrganization(TWO, () => configPropertyId(ALL_PROPERTIES));
say(allOne === null && allTwo === null, '«усі обʼєкти» — спільний рядок в обох рахунках');

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nproperty-scope.config: ${fails.length} червоних`);
  process.exit(1);
}
console.log('property-scope.config: один обʼєкт — рядок рахунку, два — рядок будинку');
assert.ok(true);
