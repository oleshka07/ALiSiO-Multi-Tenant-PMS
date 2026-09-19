/**
 * Реквізити каси, журнал і те, що відбувається, коли каса мовчить.
 *
 *   node src/modules/fiscal-ua/data/prro.check.ts
 *
 * Сцена A: драйвер за замовчуванням — `none`, і він ВІДМОВЛЯЄ названо. Це
 * головне твердження файлу: обʼєкт, якого не налаштували, не «тихо працює
 * без чека», а лишає по собі рядок журналу зі станом `failed` і текстом.
 *
 * Сцена B: чек реєструється, у журналі зʼявляється рядок `registered` із
 * фіскальним номером, і він називає ТОЙ платіж, за який виданий.
 *
 * Сцена C: каса впала — виїзд не стоїть. `registerTillReceipt` не кидає
 * НІКОЛИ, а невдача видима: `failed` + текст. Той самий закон, що для TSE
 * (`folio-payments.check.ts`, блок B): мовчазна втрата чека гірша за гучну
 * відмову.
 *
 * Сцена D: журнал належить обʼєктові. Каса стоїть у будинку (INC-029), і
 * рецепція обʼєкта А не бачить збоїв обʼєкта Б.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { oneProperty, ALL_PROPERTIES } = await import('@core/property-scope.ts');
const repo = await import('./prro.repo.ts');
const { testDevice } = await import('./test-device.ts');

const sql = getSql();
const ORG = 'org_prro';

async function cleanup() {
  for (const t of ['prro_operations', 'prro_settings']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => {});
  }
  await sql.run("DELETE FROM properties WHERE id LIKE 'prro_%'", []).catch(() => {});
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]).catch(() => {});
}

await cleanup();
await sql.run('INSERT INTO organizations(id, name, slug) VALUES (?,?,?)',
  [ORG, 'Готель на Дніпрі', 'hotel-dnipro']);

// Фікстура двох обʼєктів, не одного: твердження сцени D — про вісь обʼєкта,
// і з одним будинком воно зелене за побудовою (інваріант 26).
const ITEMS = [
  { kind: 'lodging', description: 'Проживання', quantity: 1, unit_price_gross: 1000, total_gross: 1000, vat_rate: 20 },
  { kind: 'city_tax', description: 'Туристичний збір', quantity: 1, unit_price_gross: 60, total_gross: 60, vat_rate: 0 },
];
const PAYMENTS = [{ method: 'cash', amount: 1060 }];

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['prro_kyiv', ORG, 'Київ', 'kyiv', 'UA']);
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['prro_lviv', ORG, 'Львів', 'lviv', 'UA']);

    // ── A. Ненастроєний обʼєкт: драйвер `none`, відмова названа ──────────
    const fresh = await repo.prroSettings('prro_kyiv');
    assert.strictEqual(fresh.driver, 'none',
      'обʼєкт без рядка налаштувань мусить мати драйвер none — провайдер не обирається сам');

    const refused = await repo.registerTillReceipt({
      propertyId: 'prro_kyiv', paymentId: 'pay-a', items: ITEMS, payments: PAYMENTS, currency: 'UAH',
    });
    assert.strictEqual(refused.status, 'failed', 'без драйвера чека немає');
    assert.match(String(refused.error), /No fiscal register is connected/,
      'відмова названа, а не «щось пішло не так»');
    const afterA = await repo.prroJournal(ALL_PROPERTIES);
    assert.strictEqual(afterA.length, 1, 'невдала спроба МУСИТЬ лишити рядок журналу');
    assert.strictEqual(afterA[0].status, 'failed');
    assert.strictEqual(afterA[0].payment_id, 'pay-a', 'рядок журналу називає платіж, за який чека немає');
    assert.strictEqual(afterA[0].fiscal_number, null, 'фіскальний номер не вигадується');
    console.log('  ok  A. без драйвера — названа відмова і рядок журналу, а не тиша');

    // ── B. Драйвер `test`: чек зареєстровано ────────────────────────────
    await repo.savePrroSettings({
      propertyId: 'prro_kyiv', driver: 'test', cashierName: 'О. Петренко',
      registerFiscalNumber: '4000000001', pointLocalNumber: '1', taxNumber: '1234567890',
    });
    const saved = await repo.prroSettings('prro_kyiv');
    assert.strictEqual(saved.driver, 'test');
    assert.strictEqual(saved.cashier_name, 'О. Петренко');
    assert.strictEqual(saved.register_fiscal_number, '4000000001');

    const ok = await repo.registerTillReceipt({
      propertyId: 'prro_kyiv', paymentId: 'pay-b', items: ITEMS, payments: PAYMENTS, currency: 'UAH',
    });
    assert.strictEqual(ok.status, 'registered');
    assert.ok(ok.fiscalNumber, 'зареєстрований чек мусить принести фіскальний номер');
    const rowB = (await repo.prroJournal(ALL_PROPERTIES)).find((o) => o.payment_id === 'pay-b');
    assert.ok(rowB, 'чек мусить лягти в журнал');
    assert.strictEqual(rowB.status, 'registered');
    assert.strictEqual(rowB.kind, 'receipt');
    assert.strictEqual(rowB.fiscal_number, ok.fiscalNumber, 'номер у журналі — той самий, що віддано рецепції');
    assert.strictEqual(Number(rowB.total), 1060, 'у журналі сума ЧЕКА, а не сума платежу');
    assert.ok(rowB.shift_id, 'чек мусить назвати зміну, у якій виданий');
    console.log('  ok  B. драйвер test: чек зареєстровано, номер і сума в журналі');

    // ── C. Каса впала: виїзд не стоїть, відмова гучна ───────────────────
    const broken = {
      async openShift(): Promise<never> { throw new Error('ПРРО недосяжний'); },
      async registerReceipt(): Promise<never> { throw new Error('ПРРО недосяжний'); },
      async closeShift(): Promise<never> { throw new Error('ПРРО недосяжний'); },
    };
    const down = await repo.registerTillReceipt({
      propertyId: 'prro_kyiv', paymentId: 'pay-c', items: ITEMS, payments: PAYMENTS, currency: 'UAH',
    }, broken);
    assert.strictEqual(down.status, 'failed', 'падіння каси не кидає — воно повертає стан');
    const rowC = (await repo.prroJournal(ALL_PROPERTIES)).find((o) => o.payment_id === 'pay-c');
    assert.strictEqual(rowC?.status, 'failed');
    assert.match(String(rowC?.error), /недосяжний/, 'текст збою мусить лягти в журнал, не в лог контейнера');
    assert.strictEqual(rowC?.fiscal_number ?? null, null, 'номер не вигадується й тут');

    // Відмова ЗБІРКИ — теж рядок журналу, а не виняток нагору: для рецепції
    // «часткова оплата» і «каса мовчить» означають одне — чека немає.
    const partial = await repo.registerTillReceipt({
      propertyId: 'prro_kyiv', paymentId: 'pay-c2', items: ITEMS,
      payments: [{ method: 'cash', amount: 500 }], currency: 'UAH',
    });
    assert.strictEqual(partial.status, 'failed');
    assert.match(String(partial.error), /do not agree/);
    console.log('  ok  C. каса мовчить і чек не збирається — обидва стани гучні, жоден не кидає');

    // ── D. Журнал належить обʼєктові ────────────────────────────────────
    await repo.savePrroSettings({ propertyId: 'prro_lviv', driver: 'test' });
    await repo.registerTillReceipt({
      propertyId: 'prro_lviv', paymentId: 'pay-d', items: ITEMS, payments: PAYMENTS, currency: 'UAH',
    });
    const kyiv = await repo.prroJournal(oneProperty('prro_kyiv'));
    const lviv = await repo.prroJournal(oneProperty('prro_lviv'));
    assert.ok(kyiv.length >= 4, 'у Києві чотири спроби');
    assert.strictEqual(lviv.length, 1, 'у Львові рівно одна — журнал не спільний');
    assert.ok(!kyiv.some((o) => o.property_id === 'prro_lviv'), 'Київ не бачить львівських рядків');
    assert.ok(!lviv.some((o) => o.property_id === 'prro_kyiv'), 'і навпаки');
    assert.strictEqual((await repo.prroJournal(ALL_PROPERTIES)).length, kyiv.length + lviv.length,
      '«усі обʼєкти» — це сума двох, а не один із них');
    console.log('  ok  D. журнал належить будинку: Київ і Львів не бачать одне одного');

    // ── E. Проба каси з екрана ──────────────────────────────────────────
    const probe = await repo.testPrroDevice('prro_kyiv', testDevice({ prefix: 'PROBE' }));
    assert.strictEqual(probe.status, 'registered');
    const probes = (await repo.prroJournal(oneProperty('prro_kyiv')))
      .filter((o) => o.kind === 'shift_open' || o.kind === 'shift_close');
    assert.strictEqual(probes.length, 2, 'проба лишає обидва рядки — відкриття і закриття зміни');
    assert.ok(probes.every((o) => o.status === 'registered'));

    // Чужий обʼєкт — 404, не «візьмемо перший» (інваріанти 5 і 13).
    await assert.rejects(repo.testPrroDevice('prro_nope'), /Property not found/);
    await assert.rejects(
      repo.savePrroSettings({ propertyId: 'prro_nope', driver: 'test' }), /Property not found/);
    await assert.rejects(
      repo.savePrroSettings({ propertyId: 'prro_kyiv', driver: 'checkbox' }), /Unknown fiscal driver/,
      'драйвер, якого в продукті немає, — відмова, а не запис тексту в колонку');
    console.log('  ok  E. проба каси лишає дві операції; чужий обʼєкт і невідомий драйвер — відмови');
  });
} finally {
  await cleanup();
}

console.log('каса ПРРО: ненастроєна відмовляє названо, збій гучний, журнал належить будинку');
