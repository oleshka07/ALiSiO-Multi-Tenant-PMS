/**
 * План рахунків і бізнес-юніти належать ГОТЕЛЮ, а не базі (INC-025).
 *
 *   node src/core/chart-of-accounts.check.ts
 *
 * Довідник фінансів сіявся один раз на всю базу: `SELECT id FROM organizations
 * LIMIT 1` (проти інваріанта 1) і пʼятнадцять рядків з ЛІТЕРАЛЬНИМИ
 * первинними ключами — `ec_accommodation`, `ec_other_exp`, … Другий комплект
 * неможливий за означенням PK, а `provisionOrganization` статей не сіяв
 * узагалі. `payment-bridge` при цьому пришпилював `'ec_accommodation'` кожній
 * готівковій оплаті будь-якого готелю.
 *
 * Наслідок залежав від походження бази, і обидві гілки погані:
 *   - чиста інсталяція: статей немає ні в кого, зовнішній ключ порушується →
 *     готівкова оплата віддає 500 УЖЕ ПЕРШОМУ готелю;
 *   - база, налита з демо: статті належать готелю №1, операції готелю №2
 *     тихо чіпляються на ЧУЖИЙ рядок (RI-тригери виконуються з вимкненою
 *     row security, тож ключ пропускає), а політика при читанні його ховає —
 *     звіти йдуть через `LEFT JOIN`, тож виручка не зникає, вона лягає з
 *     порожньою назвою і `COALESCE(classifier,'other')`. Проживання другого
 *     готелю потрапляє в P&L не в той рядок, мовчки.
 *
 * Сцена: ДВА готелі, заведені справжнім писачем (`provisionOrganization`), і
 * кожне твердження з обох боків. Один готель не доводить нічого — з ним усе
 * зламане виглядає цілим (AGENTS §7).
 *
 * Осі (інваріант 26): готелів два, і жоден ідентифікатор довідника не
 * збігається; коди при цьому збігаються ОБИДВА — інакше «у кожного своє»
 * читалося б і як «у другого просто інші назви».
 */
import assert from 'node:assert';
import '../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('./db/async.ts');
const { runWithOrganization } = await import('./auth/tenant-context.ts');
const { provisionOrganization } = await import('./provisioning.ts');
const { CHART_OF_ACCOUNTS, BUSINESS_UNITS, categoryIdByCode } = await import('./chart-of-accounts.ts');

const sql = getSql();
const SLUGS = ['coa-check-one', 'coa-check-two'];

async function cleanup() {
  for (const slug of SLUGS) {
    const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [slug]);
    if (org) await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
  }
}

await cleanup();

const fails: string[] = [];
const say = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

try {
  const one = await provisionOrganization({
    name: 'Hotel One', slug: SLUGS[0], ownerEmail: 'one@coa.check',
    ownerPassword: 'coa-check-password-1', currency: 'CZK', language: 'uk',
  });
  const two = await provisionOrganization({
    name: 'Hotel Two', slug: SLUGS[1], ownerEmail: 'two@coa.check',
    ownerPassword: 'coa-check-password-2', currency: 'EUR', language: 'de',
  });

  // ── 1. У КОЖНОГО свій повний довідник ────────────────────────────────────
  for (const [label, org] of [['перший', one], ['другий', two]] as const) {
    const cats = await sql.rows<{ id: string; code: string }>(
      'SELECT id, code FROM expense_categories WHERE organization_id = ? ORDER BY code', [org.organizationId]);
    say(cats.length === CHART_OF_ACCOUNTS.length,
      `${label} готель отримав ${cats.length} статей замість ${CHART_OF_ACCOUNTS.length} — план рахунків сіявся не йому`);
    const units = await sql.rows<{ id: string; code: string }>(
      'SELECT id, code FROM business_units WHERE organization_id = ? ORDER BY code', [org.organizationId]);
    say(units.length === BUSINESS_UNITS.length,
      `${label} готель отримав ${units.length} бізнес-юнітів замість ${BUSINESS_UNITS.length}`);
  }

  // ── 2. Коди ті самі, ІДЕНТИФІКАТОРИ різні ────────────────────────────────
  const codesOne = (await sql.rows<{ code: string }>(
    'SELECT code FROM expense_categories WHERE organization_id = ? ORDER BY code', [one.organizationId]))
    .map((r) => r.code);
  const codesTwo = (await sql.rows<{ code: string }>(
    'SELECT code FROM expense_categories WHERE organization_id = ? ORDER BY code', [two.organizationId]))
    .map((r) => r.code);
  say(codesOne.length > 0 && JSON.stringify(codesOne) === JSON.stringify(codesTwo),
    'коди довідника мусять збігатися в обох готелів — інакше це не «у кожного своє», а «у другого інше»');

  const idsOne = new Set((await sql.rows<{ id: string }>(
    'SELECT id FROM expense_categories WHERE organization_id = ?', [one.organizationId])).map((r) => r.id));
  const idsTwo = (await sql.rows<{ id: string }>(
    'SELECT id FROM expense_categories WHERE organization_id = ?', [two.organizationId])).map((r) => r.id);
  const shared = idsTwo.filter((id) => idsOne.has(id));
  say(shared.length === 0,
    `${shared.length} ідентифікаторів довідника СПІЛЬНІ для двох готелів (${shared.slice(0, 3).join(', ')}) — рядок належить тому, хто завівся першим`);

  const buIdsOne = new Set((await sql.rows<{ id: string }>(
    'SELECT id FROM business_units WHERE organization_id = ?', [one.organizationId])).map((r) => r.id));
  const buShared = (await sql.rows<{ id: string }>(
    'SELECT id FROM business_units WHERE organization_id = ?', [two.organizationId]))
    .map((r) => r.id).filter((id) => buIdsOne.has(id));
  say(buShared.length === 0,
    `${buShared.length} бізнес-юнітів СПІЛЬНІ для двох готелів — той самий клас, що зі статтями`);

  // ── 3. Резолвер віддає СВОЮ статтю, у контексті кожного орендаря ─────────
  const resolvedOne = await runWithOrganization(one.organizationId, () => categoryIdByCode('accommodation'));
  const resolvedTwo = await runWithOrganization(two.organizationId, () => categoryIdByCode('accommodation'));
  say(Boolean(resolvedOne) && Boolean(resolvedTwo),
    'резолвер не знайшов статтю проживання — саме сюди впирається кожна готівкова оплата');
  say(resolvedOne !== resolvedTwo,
    `обидва готелі резолвлять проживання в ОДИН рядок (${resolvedOne}) — це і є INC-025`);
  say(idsTwo.includes(String(resolvedTwo)),
    'другий готель резолвиться в рядок, якого немає серед його власних');

  console.log(`  один: ${codesOne.length} статей, проживання → ${resolvedOne}`);
  console.log(`  два:  ${codesTwo.length} статей, проживання → ${resolvedTwo}`);

  // ── 4. Ключ із орендарем — НЕ ЗРОБЛЕНО, і твердження тут немає навмисно ──
  //
  // Складений ключ `(organization_id, category_id)` був написаний, перебудова
  // `fin_operations` пройшла, і твердження «операцію другого готелю НЕ пустило
  // на статтю першого» було червоним до нього і зеленим після. Відкочено:
  // `scripts/pg-schema.mjs` складених ключів не вміє — він розкладає їх на два
  // одноколонкові й видає, зокрема,
  // `FOREIGN KEY (organization_id) REFERENCES business_units(organization_id)`,
  // тобто констрейнт, який означає не те. Схема Postgres генерується з SQLite
  // (інваріант 10), і неправильний констрейнт у ній гірший за відсутній.
  //
  // Порожнього твердження замість справжнього тут не лишається: гейт, який
  // «перевіряє» те, чого немає, доповідає про безпеку, якої немає (AGENTS §4).
  // Межу поки тримає те, що нижче: жоден шлях коду не вміє скласти посилання
  // на чужий рядок.

  // ── 5. Жодного літерального ідентифікатора в коді ────────────────────────
  const fs = await import('node:fs');
  const bridge = fs.readFileSync('src/modules/finance/api/payment-bridge.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p1: string) => p1 + ' '.repeat(m.length - p1.length));
  say(!/'ec_\w+'/.test(bridge),
    'у містку платежів лишився літеральний ідентифікатор статті — він належить готелю, що завівся першим');
} finally {
  await cleanup();
}

if (fails.length) {
  console.log(`\nchart-of-accounts: ${fails.length} червоних`);
  for (const f of fails) console.log(`  ЧЕРВОНЕ  ${f}`);
  process.exit(1);
}
console.log('chart-of-accounts: у кожного готелю свій план рахунків і свої бізнес-юніти, коди спільні, рядки — ні');
assert.ok(true);
