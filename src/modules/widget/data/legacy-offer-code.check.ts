/**
 * Купон за кодом належить СВОЄМУ готелю — і нікому іншому.
 *
 *   node src/modules/widget/data/legacy-offer-code.check.ts
 *
 * Рецензія 07.09 раунд 2, правка 4.4. Три читання купона в
 * `widget-reserve.handlers.ts` фільтрували за кодом і датами, але НЕ за
 * організацією. Маршрут бронювання публічний, тож код, що належить купону
 * чужого готелю, знаходився з чужої броні: знижка віднімалась від нашої суми,
 * а `current_uses` ріс у сусіда — у нього ліміт вичерпувався від чужих
 * бронювань, і побачити це можна було лише за лічильником.
 *
 * Гірше того, разом із промо-правилами (Ц31) один і той самий рядок коду
 * проходив обидва шляхи: `isLegacyOfferCode` казав «це не купон» (бо там
 * організація перевіряється), правило спрацьовувало — і незакрите читання
 * знаходило ЩЕ й чужий купон.
 *
 * Осі (інваріант 26): дві організації з ОДНАКОВИМ кодом і різними знижками
 * (10 % і 50 %) — «узяли перший знайдений» на такій фікстурі дає чуже число;
 * плюс пакет, скоупований через `booking_sites`, і код, якого немає ні в кого.
 */
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { offerForCode, isLegacyOfferCode } = await import('./legacy-offer-code.ts');

const sql = getSql();
const A = '__offer_a__';
const B = '__offer_b__';
const CODE = 'SPRING10';
const WINDOW = { checkIn: '2026-11-10', checkOut: '2026-11-12' };

async function cleanup() {
  for (const o of [A, B]) {
    await sql.run('DELETE FROM gift_card_bundles WHERE site_id = ?', [`${o}_site`]);
    await sql.run('DELETE FROM booking_sites WHERE organization_id = ?', [o]);
    await sql.run('DELETE FROM coupons WHERE organization_id = ?', [o]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [o]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [o]);
  }
}

await cleanup();
try {
  for (const [o, amount] of [[A, 10], [B, 50]] as [string, number][]) {
    await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [o, o, o]);
    await sql.run(
      `INSERT INTO coupons (id, organization_id, code, discount_type, offer_amount, is_active, current_uses)
       VALUES (?, ?, ?, 'percentage', ?, TRUE, 0)`,
      [`${o}_coupon`, o, CODE, amount],
    );
  }

  // ── 1. Кожна організація бачить СВІЙ купон ────────────────────────────
  const forA = await offerForCode(sql, CODE, A, WINDOW);
  const forB = await offerForCode(sql, CODE, B, WINDOW);
  assert.strictEqual(forA.offer?.id, `${A}_coupon`, 'організація A мусить дістати свій купон');
  assert.strictEqual(forB.offer?.id, `${B}_coupon`, 'а B — свій');
  assert.strictEqual(Number(forA.offer?.offer_amount), 10, 'і свою знижку: 10 %, не 50 % сусіда');
  assert.strictEqual(Number(forB.offer?.offer_amount), 50, 'і навпаки');

  // ── 2. Код, якого ця організація не має, не знаходиться ───────────────
  await sql.run('DELETE FROM coupons WHERE organization_id = ?', [A]);
  const gone = await offerForCode(sql, CODE, A, WINDOW);
  assert.strictEqual(gone.offer, null,
    'купон сусіда з тим самим кодом не має знаходитись: гроші віднялись би від нашої суми, а лічильник виріс би в нього');
  assert.strictEqual(Number((await sql.row<any>('SELECT current_uses FROM coupons WHERE id = ?', [`${B}_coupon`]))?.current_uses), 0,
    'і чужий лічильник не рухається');

  // ── 3. Пакет скоупується через booking_sites ──────────────────────────
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [`${B}_prop`, B, 'B', `${B}_prop`]);
  await sql.run('INSERT INTO booking_sites (id, organization_id, property_id, name, slug) VALUES (?, ?, ?, ?, ?)',
    [`${B}_site`, B, `${B}_prop`, 'B', `${B}_site`]);
  await sql.run(
    `INSERT INTO gift_card_bundles (id, organization_id, site_id, name, price, coupon_code, is_active, current_uses)
     VALUES (?, (SELECT organization_id FROM booking_sites WHERE id = ?), ?, 'Пакет', 8500, ?, TRUE, 0)`,
    [`${B}_bundle`, `${B}_site`, `${B}_site`, 'PACK2'],
  );
  const bundleForB = await offerForCode(sql, 'PACK2', B, WINDOW);
  assert.strictEqual(bundleForB.offer?.id, `${B}_bundle`, 'своя організація бачить свій пакет');
  assert.strictEqual(bundleForB.isBundle, true, 'і він названий пакетом — знижка рахується інакше');
  const bundleForA = await offerForCode(sql, 'PACK2', A, WINDOW);
  assert.strictEqual(bundleForA.offer, null, 'чужий пакет не знаходиться — він за booking_sites сусіда');

  // ── 4. Межа з промо-правилами лишається цілою ─────────────────────────
  assert.strictEqual(await isLegacyOfferCode(sql, 'PACK2', B), true, 'код пакета для B — старий купон, до правил не доходить');
  assert.strictEqual(await isLegacyOfferCode(sql, 'PACK2', A), false, 'для A той самий рядок купоном не є — його код вільний для правил');

  // ── 5. Хендлер бронювання ходить ЦИМ читачем, а не своїм SELECT ───────
  //
  // Поведінковим твердженням це не покрити: `POST /api/widget/reserve`
  // будує бронь із сайту, номера, цін і платежу — засів на нього більший за
  // саму правку. Тому вісь тримається статично: щойно в хендлері знову
  // зʼявиться власне читання `coupons`, гейт червоний.
  const handler = await readFile(new URL('../api/widget-reserve.handlers.ts', import.meta.url), 'utf8');
  const code = handler.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.strictEqual((code.match(/offerForCode\(/g) || []).length, 2,
    'обидва коди — основний і додатковий — читаються скоупованим читачем');
  assert.ok(!/FROM\s+coupons/i.test(code),
    'власного SELECT із coupons у хендлері бути не має: він знову лишиться без організації');
  assert.ok(!/FROM\s+gift_card_bundles/i.test(code),
    'і власного SELECT із gift_card_bundles теж — пакет скоупується через booking_sites');

  console.log('legacy-offer-code: купон і пакет читаються лише в межах своєї організації; чужий лічильник не рухається');
} finally {
  await cleanup();
}
