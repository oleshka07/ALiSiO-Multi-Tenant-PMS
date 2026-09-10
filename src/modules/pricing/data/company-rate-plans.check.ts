/**
 * Фірмовий тариф бачить і купує лише своя фірма.
 *
 *   node src/modules/pricing/data/company-rate-plans.check.ts
 *
 * ── Що ламається без цього (INC-205, CORE-GAPS п.1) ─────────────────────
 *
 * Ґрайц продає фірмам, і в його живій базі 12 фірм зі знижкою. У Winhotel це
 * не знижка, а ОКРЕМИЙ ПРАЙС — доводять його ж числа: `SD 80,10` проти
 * `84 × 0,9 = 75,60`. Якби це була знижка, вони збіглися б.
 *
 * У нас звʼязку «цей тариф — цієї фірми» не було ніде: `price_rules` умов
 * «для компанії» не мають, `rate_plans` про компанії не знає. Тобто фірмову
 * ціну не можна ані показати правильному платнику, ані сховати від решти.
 *
 * ── Три твердження, і третє головне ─────────────────────────────────────
 *
 *   1. платник-фірма А бачить тариф А і НЕ бачить тариф Б;
 *   2. гість, який платить сам, не бачить жодного фірмового;
 *   3. **писач відмовляє** на чужий фірмовий `rate_plan_id`, названий ззовні.
 *
 * Третє головне тому, що перші два — про СПИСОК, а список нікого не тримає:
 * `POST /api/pricing/quote` бере `ratePlanId` із тіла запиту. Полагодити лише
 * список означало б лишити двері, крізь які фірмову ціну дістає будь-хто, хто
 * знає ідентифікатор тарифу. Це той самий клас, за який ми вже платили тричі
 * за дві доби — INC-201, INC-202, INC-203: **читач полагоджений, писач
 * лишився відчиненим**. Тут він названий четвертим разом і закритий у тому
 * самому коміті, що й читач.
 *
 * Чужий тариф — **404**, не 403 (інваріант 5), і тим самим текстом, що
 * неіснуючий: інакше відповідь сама каже, що тариф існує і чийсь, тобто стає
 * оракулом того ж роду, що INC-047.
 *
 * ── Осі фікстури (інваріант 26) ─────────────────────────────────────────
 *
 * Сцена стверджує про ВИДИМІСТЬ і ВІДМОВУ, тож її осі — не гроші, а
 * належність. Їх три, і на кожній щонайменше два значення:
 *
 *   платник        — фірма А, фірма Б, і гість без фірми;
 *   рід тарифу     — звичайний, прихований нефірмовий, фірмовий;
 *   належність     — тариф ДЛЯ ВСІХ ФІРМ (код 3) проти тарифу ОДНІЄЇ (код 10).
 *
 * Третю видно лише на ДВОХ фірмах: з однією «для всіх фірм» і «для цієї
 * фірми» дають той самий результат — і саме ця вісь вирішує, таблиця це чи
 * колонка. Числа прайса (84,00 проти 80,10) стверджуються там, де вони
 * стають грошима, — у `company-rate-quote.check.ts`.
 *
 * ── Фірмові тарифи тут НЕ приховані, і це навмисно ──────────────────────
 *
 * `is_hidden` ставиться галочкою руками. Якби варта трималась на ньому,
 * фірмовий тариф без галочки продавався б кожному — тобто захист залежав би
 * від того, чи не забув оператор клацнути. Доведено зламом: підміна умови
 * `links > 0` на `is_hidden` робить сцену червоною («фірма А купила тариф
 * фірми Б»), хоч жодного фірмового тарифу у фікстурі не приховано.
 *
 * ── Червоність доведена ЧОТИРМА зломами ─────────────────────────────────
 *
 *   1. фільтр платника знято зі списку        → тверд. 1 («отримали FIRMA_B»)
 *   2. писач пускає будь-який фірмовий        → тверд. 3
 *   3. та сама помилка ІНШОЮ ФОРМОЮ: підзапит
 *      «mine» не звіряє фірму (§3.2.1)        → тверд. 3
 *   4. варта на `is_hidden` замість звʼязку   → тверд. 3
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-company-rates-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { ratePlansForPayer, assertRatePlanForPayer } = await import('./company-rate-plans.repo.ts');

const sql = getSql();

const ORG = '__crp__org';
const PROP = `${ORG}_prop`;
const CAT = `${ORG}_cat`;
const TYPE = `${ORG}_type`;

/** Дві фірми — інакше «для всіх фірм» і «для цієї фірми» невідрізнимі. */
const FIRMA_A = `${ORG}_firma_a`;
const FIRMA_B = `${ORG}_firma_b`;

const STANDARD = `${ORG}_rp_standard`;
const FIRMENPREISE = `${ORG}_rp_firmen`;   // код 3: для ВСІХ фірм
const ONLY_B = `${ORG}_rp_only_b`;         // код 10: лише фірмі Б
const HIDDEN = `${ORG}_rp_hidden`;         // прихований, але НЕ фірмовий

// Сцена бігає і на SQLite (`npm run check`, тимчасова тека), і на СПРАВЖНЬОМУ
// Postgres (`npm run check:pg`, база лишається між прогонами). Тому вона
// прибирає за собою на вході, а не покладається на порожню базу; і всі записи
// йдуть у контексті орендаря — на Postgres запис без нього відхиляє політика
// (інваріант 11).
await runWithOrganization(ORG, async () => {
  for (const table of ['company_rate_plans', 'price_calendar', 'rate_plans', 'unit_types', 'categories', 'companies']) {
    try {
      await sql.run(`DELETE FROM ${table} WHERE id LIKE '${ORG}%' OR id LIKE '${ORG}_%'`);
    } catch { /* колонки id немає або рядків немає — не наша справа */ }
  }
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
});
await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);

await sql.run('INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, ?)', [ORG, ORG, ORG, 'EUR']);

await runWithOrganization(ORG, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, 'Greiz', PROP]);
  await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);
  await sql.run(
    `INSERT INTO unit_types (id, property_id, category_id, name, code, base_occupancy, max_adults, max_children, max_occupancy)
     VALUES (?, ?, ?, 'Doppelzimmer', 'DZD', 2, 4, 2, 6)`,
    [TYPE, PROP, CAT],
  );

  for (const [id, name] of [[FIRMA_A, 'Firma A'], [FIRMA_B, 'Firma B']]) {
    await sql.run('INSERT INTO companies (id, organization_id, name) VALUES (?, ?, ?)', [id, ORG, name]);
  }

  const plan = async (id: string, code: string, name: string, hidden: boolean) => {
    await sql.run(
      `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active, is_hidden)
       VALUES (?, ?, ?, ?, 'EUR', TRUE, ?)`,
      [id, PROP, name, code, hidden],
    );
  };
  await plan(STANDARD, 'STD', 'Standard', false);
  // Фірмові тарифи заведені БЕЗ галочки «прихований» навмисно: правило мусить
  // триматись на звʼязку, а не на тому, чи не забув оператор її поставити.
  await plan(FIRMENPREISE, 'FIRMEN', 'Firmenpreise', false);
  await plan(ONLY_B, 'FIRMA_B', 'Firma B Preis', false);
  await plan(HIDDEN, 'HID', 'Прихований, не фірмовий', true);

  const link = async (companyId: string, ratePlanId: string) => {
    // Орендар — підзапитом від рядка, на якому висить звʼязок (інваріант 12):
    // так він не може розійтися з фірмою навіть там, де сесії немає.
    await sql.run(
      `INSERT INTO company_rate_plans (id, organization_id, company_id, rate_plan_id)
       VALUES (?, (SELECT organization_id FROM companies WHERE id = ?), ?, ?)`,
      [`${companyId}_${ratePlanId}`, companyId, companyId, ratePlanId],
    );
  };
  // «Firmenpreise» — обом фірмам; «Firma B Preis» — лише Б.
  await link(FIRMA_A, FIRMENPREISE);
  await link(FIRMA_B, FIRMENPREISE);
  await link(FIRMA_B, ONLY_B);
});

const codesFor = async (companyId: string | null) =>
  await runWithOrganization(ORG, async () =>
    (await ratePlansForPayer(PROP, ORG, companyId)).map((p) => p.code).sort());

const refusedFor = async (ratePlanId: string, companyId: string | null) =>
  await runWithOrganization(ORG, async () => {
    try {
      await assertRatePlanForPayer(ratePlanId, ORG, companyId);
      return null;
    } catch (e: any) {
      return { status: e?.status, message: e?.message };
    }
  });

try {
  // ── 1. Фірма А бачить свій фірмовий і не бачить чужого ───────────────
  {
    const codes = await codesFor(FIRMA_A);
    assert.deepStrictEqual(codes, ['FIRMEN', 'STD'],
      `фірма А мала бачити Standard і Firmenpreise, отримали ${JSON.stringify(codes)}: `
      + 'поява FIRMA_B означає, що тариф чужої фірми продається цій');
  }
  {
    const codes = await codesFor(FIRMA_B);
    assert.deepStrictEqual(codes, ['FIRMA_B', 'FIRMEN', 'STD'],
      `фірма Б мала бачити три тарифи, отримали ${JSON.stringify(codes)}`);
  }
  console.log('  ok  фірма бачить свої фірмові тарифи і не бачить чужих');

  // ── 2. Гість, який платить сам, не бачить жодного фірмового ──────────
  //
  // І прихований нефірмовий тут теж не зʼявляється — `is_hidden` робить своє,
  // як робив: другого механізму для каналу не заведено.
  {
    const codes = await codesFor(null);
    assert.deepStrictEqual(codes, ['STD'],
      `гість без фірми мав бачити лише Standard, отримали ${JSON.stringify(codes)}`);
  }
  console.log('  ok  платник без фірми не бачить жодного фірмового тарифу');

  // ── 3. ПИСАЧ: чужий фірмовий id, названий ззовні, — 404 ──────────────
  //
  // Головне твердження. Без нього перші два зелені й на коді, де список
  // звужений, а котирування бере будь-який названий тариф.
  {
    const alien = await refusedFor(ONLY_B, FIRMA_A);
    assert.ok(alien, 'фірма А купила тариф фірми Б, назвавши його ідентифікатор');
    assert.strictEqual(alien!.status, 404,
      `чужий тариф — чужий id, тобто 404 (інваріант 5), а не ${alien!.status}`);

    const noPayer = await refusedFor(FIRMENPREISE, null);
    assert.ok(noPayer, 'гість без фірми купив фірмовий тариф, назвавши ідентифікатор');
    assert.strictEqual(noPayer!.status, 404, `мав бути 404, а не ${noPayer!.status}`);

    // Той самий текст, що на неіснуючий тариф: інакше відповідь сама каже,
    // що тариф є і чийсь (клас INC-047).
    const missing = await refusedFor(`${ORG}_rp_nema`, FIRMA_A);
    assert.strictEqual(alien!.message, missing!.message,
      'відмова на ЧУЖИЙ тариф відрізняється текстом від відмови на НЕІСНУЮЧИЙ — '
      + 'так відповідь сама підтверджує, що тариф існує');
  }
  console.log('  ok  писач: чужий фірмовий тариф — 404 тим самим текстом, що неіснуючий');

  // ── 4. Дзеркало: свій фірмовий і звичайний ПРОХОДЯТЬ ─────────────────
  //
  // Без цього все вище було б зелене й на коді, який відмовляє кожному
  // тарифу взагалі.
  {
    assert.strictEqual(await refusedFor(FIRMENPREISE, FIRMA_A), null,
      'фірма А не змогла купити тариф, до якого привʼязана');
    assert.strictEqual(await refusedFor(ONLY_B, FIRMA_B), null,
      'фірма Б не змогла купити свій власний тариф');
    assert.strictEqual(await refusedFor(STANDARD, null), null,
      'звичайний тариф перестав продаватись гостю без фірми');
    assert.strictEqual(await refusedFor(STANDARD, FIRMA_A), null,
      'звичайний тариф перестав продаватись фірмі');
  }
  console.log('  ok  свій фірмовий і звичайний тариф проходять (контроль)');

  // ── 5. Сусідній орендар не дістає нічого ─────────────────────────────
  //
  // Вісь орендаря: та сама пара id, але інша організація. Без цього
  // твердження сцена нічого не каже про мультитенантність.
  {
    const alienOrg = await refusedFor(FIRMENPREISE, FIRMA_A);
    assert.strictEqual(alienOrg, null, 'контроль зіпсовано');
    let refused: any = null;
    try {
      // Контекст орендаря теж сусідський: на Postgres саме він вирішує, що
      // видно, і твердження про політику мусить її й питати (інваріант 11).
      await runWithOrganization('__crp__neighbour', async () => {
        await assertRatePlanForPayer(FIRMENPREISE, '__crp__neighbour', FIRMA_A);
      });
    } catch (e: any) { refused = e; }
    assert.ok(refused, 'тариф нашого готелю дозволено в контексті СУСІДНЬОГО орендаря');
    assert.strictEqual(refused.status, 404, `мав бути 404, а не ${refused.status}`);
  }
  console.log('  ok  той самий тариф у контексті сусіднього орендаря — 404');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('company-rate-plans: фірмовий тариф бачить і купує лише своя фірма (INC-205)');
