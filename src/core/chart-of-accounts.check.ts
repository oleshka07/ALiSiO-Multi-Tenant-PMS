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
    if (!org) continue;
    // Дочірні рядки знімаються В КОНТЕКСТІ ОРЕНДАРЯ (INC-014): на Postgres під
    // роллю застосунку вони під політикою, і `DELETE` без контексту прибирає
    // НУЛЬ — мовчки, бо «нічого не видалено» це не помилка.
    await runWithOrganization(org.id, async () => {
      // ПОРЯДОК: `app_users` перед `finance_accounts`. Власник посилається на
      // касу через `default_cash_account_id` (Д26), і ключ не каскадний —
      // видалення каси, поки на неї дивиться користувач, відхиляється.
      await sql.run('DELETE FROM expense_categories WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM business_units WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM finance_accounts WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org.id]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
  }
}

await cleanup();

const fails: string[] = [];
const say = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

try {
  // `country` тут не косметика: з 0113 пояс обовʼязковий, і мовчазної Праги
  // більше немає. Довідник рахунків від поясу не залежить — країна названа
  // рівно щоб `provisionOrganization` мав звідки вивести пояс.
  const one = await provisionOrganization({
    name: 'Hotel One', slug: SLUGS[0], ownerEmail: 'one@coa.check',
    ownerPassword: 'coa-check-password-1', currency: 'CZK', language: 'uk', country: 'CZ',
  });
  const two = await provisionOrganization({
    name: 'Hotel Two', slug: SLUGS[1], ownerEmail: 'two@coa.check',
    ownerPassword: 'coa-check-password-2', currency: 'EUR', language: 'de', country: 'DE',
  });

  // ── 1. У КОЖНОГО свій повний довідник ────────────────────────────────────
  //
  // КОЖНЕ читання — у контексті СВОГО орендаря (INC-014). На Postgres під роллю
  // застосунку довідник під політикою: запит без контексту віддає нуль рядків,
  // і твердження «отримав 0 статей» було б правдою про перевірку, а не про код.
  // Під суперкористувачем і на SQLite цього не видно — саме так ця перевірка
  // проходила локально й падала в CI.
  const catsOf = (org: { organizationId: string }) => runWithOrganization(org.organizationId, () =>
    sql.rows<{ id: string; code: string }>(
      'SELECT id, code FROM expense_categories WHERE organization_id = ? ORDER BY code', [org.organizationId]));
  const unitsOf = (org: { organizationId: string }) => runWithOrganization(org.organizationId, () =>
    sql.rows<{ id: string; code: string }>(
      'SELECT id, code FROM business_units WHERE organization_id = ? ORDER BY code', [org.organizationId]));

  for (const [label, org] of [['перший', one], ['другий', two]] as const) {
    const cats = await catsOf(org);
    say(cats.length === CHART_OF_ACCOUNTS.length,
      `${label} готель отримав ${cats.length} статей замість ${CHART_OF_ACCOUNTS.length} — план рахунків сіявся не йому`);
    const units = await unitsOf(org);
    say(units.length === BUSINESS_UNITS.length,
      `${label} готель отримав ${units.length} бізнес-юнітів замість ${BUSINESS_UNITS.length}`);
  }

  // ── 2. Коди ті самі, ІДЕНТИФІКАТОРИ різні ────────────────────────────────
  const codesOne = (await catsOf(one)).map((r) => r.code);
  const codesTwo = (await catsOf(two)).map((r) => r.code);
  say(codesOne.length > 0 && JSON.stringify(codesOne) === JSON.stringify(codesTwo),
    'коди довідника мусять збігатися в обох готелів — інакше це не «у кожного своє», а «у другого інше»');

  const idsOne = new Set((await catsOf(one)).map((r) => r.id));
  const idsTwo = (await catsOf(two)).map((r) => r.id);
  const shared = idsTwo.filter((id) => idsOne.has(id));
  say(shared.length === 0,
    `${shared.length} ідентифікаторів довідника СПІЛЬНІ для двох готелів (${shared.slice(0, 3).join(', ')}) — рядок належить тому, хто завівся першим`);

  const buIdsOne = new Set((await unitsOf(one)).map((r) => r.id));
  const buShared = (await unitsOf(two)).map((r) => r.id).filter((id) => buIdsOne.has(id));
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

  // ── 4. ВЛАСТИВІСТЬ: довідник одного готелю недосяжний для другого ────────
  //
  // Твердження навмисно про ВЛАСТИВІСТЬ, а не про механізм. Механізмів у неї
  // може бути кілька — унікальний у межах орендаря `code` і резолвер за
  // орендарем сьогодні, складений зовнішній ключ колись, — і твердження про
  // механізм померло б разом із ним, лишивши властивість неперевіреною.
  //
  // Складений ключ `(organization_id, category_id)` тут свідомо НЕ береться:
  // `scripts/pg-schema.mjs` складених ключів не вміє — він розкладає їх на два
  // одноколонкові й видає, зокрема,
  // `FOREIGN KEY (organization_id) REFERENCES business_units(organization_id)`,
  // констрейнт, який означає не те. Схема Postgres генерується з SQLite
  // (інваріант 10), і неправильний ключ у ній гірший за відсутній. Рішення
  // контролера 07.09: береться разом із правкою генератора, коли зʼявиться
  // друга схема, якій складений ключ потрібен (LATER). До того межу тримає
  // те, що стверджується нижче.
  for (const [label, mine, foreign] of [
    ['другий', two, String(resolvedOne)],
    ['перший', one, String(resolvedTwo)],
  ] as const) {
    const reachable = await runWithOrganization(mine.organizationId, () =>
      sql.row<{ id: string }>(
        'SELECT id FROM expense_categories WHERE organization_id = ? AND id = ?',
        [mine.organizationId, foreign]));
    say(!reachable,
      `${label} готель ДІСТАЄ статтю сусіда за її ідентифікатором (${foreign}) — довідник спільний`);
    // І з іншого боку: своя стаття за тим самим кодом знаходиться завжди,
    // інакше «не дістає» означало б просто «не знаходить нічого».
    const own = await runWithOrganization(mine.organizationId, () => categoryIdByCode('accommodation'));
    say(Boolean(own) && own !== foreign,
      `${label} готель не має власної статті проживання — тоді попереднє твердження беззмістовне`);
  }

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
