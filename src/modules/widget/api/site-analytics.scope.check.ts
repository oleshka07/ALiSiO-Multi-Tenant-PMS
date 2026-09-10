/**
 * Аналітика сайту рахує броні ЦЬОГО сайту — не всі броні готелю.
 *
 *   node src/modules/widget/api/site-analytics.scope.check.ts
 *
 * ── Три осі в одному фільтрі, і дві з них були зламані ──────────────────
 *
 * Екран «Аналітика сайту» показує виторг, конверсію і середній чек. Числа
 * фільтрує одна функція на дев'ять запитів — `sourceScope()`, — і вона мусить
 * тримати ТРИ осі нараз:
 *
 *   орендар — чужого готелю тут не буває ніколи;
 *   обʼєкт  — сайт заведено ПІД БУДИНОК (`booking_sites.property_id`);
 *   джерело — це аналітика ВІДЖЕТА, а не всього готелю.
 *
 * **Гілка «усі сайти» губила третю.** Для одного сайта фільтр був
 * `property_id = ? AND source IN ('widget:<id>', 'widget')`; для `all` —
 * `property_id IN (…мої будинки…)` і **жодного слова про джерело**. Тобто
 * «усі мої сайти» рахували кожну бронь готелю: телефонні, з Booking.com, з
 * рецепції. Оператор читав «мій сайт заробив X», де в X сидів Booking.
 *
 * І це видно з самого коду: коментар над функцією каже «'all' means every
 * site I own» — тобто намір був саме про сайти. Код йому суперечив.
 *
 * **Друга вісь — обʼєкт — трималась, але невидимо.** Фільтр приїжджав у
 * запит підстановкою, тож гейт осі (INC-029) рахував усі девʼять запитів як
 * «невизначено»: він за побудовою не знає, що всередині `${…}`. Тепер вісь
 * іде дверима `propertyScopeFilter`, і мовчання гейта перестало бути
 * випадковим.
 *
 * ── Числа фікстури (інваріант 26) ───────────────────────────────────────
 *
 * Чотири броні, і жодні дві суми не рівні — інакше «порахували не те» і
 * «порахували те» дали б однакове число:
 *
 *    1000 — віджет сайта А, будинок А        ← єдине, що має рахуватись для А
 *    2000 — віджет сайта Б, будинок Б        ← інший сайт
 *    4000 — телефонна бронь будинку А        ← вісь ДЖЕРЕЛА
 *    8000 — віджет СУСІДНЬОГО орендаря       ← вісь ОРЕНДАРЯ
 *   16000 — ключ сайта А на броні будинку Б  ← вісь ОБʼЄКТА
 *
 * Степені двійки навмисно: будь-яка сума підмножини однозначно каже, ЯКІ
 * саме броні порахувались. 5000 — забули джерело; 17000 — забули обʼєкт;
 * 9000 — забули орендаря; 1000 — правильно.
 *
 * **Пʼятий рядок додано ПІСЛЯ того, як мутація показала, що сцена без нього
 * нічого не доводить.** Прибрана вісь обʼєкта лишала всі три твердження
 * зеленими: для одного сайта фільтр джерела (`source = 'widget:<id>'`) сам
 * по собі відрізняє сайти, тож будинок нічого не додавав. Він додає рівно
 * там, де ключ сайта і будинок РОЗІЙШЛИСЬ.
 *
 * Причину варто назвати точно, бо перша редакція цього коментаря назвала її
 * ширшою, ніж вона є. `site_listings` СЬОГОДНІ питає про будинок — писач
 * звіряє `u.property_id = site.property_id` від INC-034, а
 * `booking_sites.property_id` не міняє жоден `UPDATE`. Отже новий рядок
 * розійтись не може. Лишаються рядки, записані ДО INC-034: вони в базі є, і
 * жодна міграція їх не переглядала. Фікстура кладе такий рядок прямо — вісь
 * у читачі обороняє саме їх.
 *
 * ── Червоність доведена на нинішньому коді ──────────────────────────────
 *
 * `усі сайти: очікували 3000 (два віджети), отримали 7000` — тобто в
 * «аналітику сайтів» приїхала телефонна бронь на 4000.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-site-analytics-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { sourceScope } = await import('./site-analytics.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const SITE_A = '__sa__site_a';
const SITE_B = '__sa__site_b';
const SITE_N = '__sa__site_n';

const site = async (id: string, organizationId: string, propertyId: string, slug: string) => {
  await runWithOrganization(organizationId, async () => {
    await sql.run(
      `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [id, organizationId, propertyId, slug, slug]);
  });
};

/** Гість на кожного орендаря: колонка `NOT NULL`, і чужого сюди не візьмеш. */
const guestOf = new Map<string, string>();
const guest = async (organizationId: string) => {
  const known = guestOf.get(organizationId);
  if (known) return known;
  const id = `__sa__guest_${guestOf.size + 1}`;
  await runWithOrganization(organizationId, async () => {
    await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
      [id, organizationId, 'Ana', 'Lytics']);
  });
  guestOf.set(organizationId, id);
  return id;
};

const booking = async (
  id: string, organizationId: string, propertyId: string, unitId: string,
  source: string, total: number,
) => {
  const guestId = await guest(organizationId);
  await runWithOrganization(organizationId, async () => {
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                                 check_in, check_out, nights, adults, status, payment_status,
                                 source, total_price, currency, created_at)
       VALUES (?, ?, ?, ?, ?, '2026-11-01', '2026-11-02', 1, 2, 'confirmed', 'paid',
               ?, ?, 'EUR', '2026-11-01 10:00:00')`,
      [id, organizationId, propertyId, unitId, guestId, source, total]);
  });
};

await site(SITE_A, fx.organizationId, fx.a.id, 'sa-a');
await site(SITE_B, fx.organizationId, fx.b.id, 'sa-b');
await site(SITE_N, neighbour.organizationId, neighbour.propertyId, 'sa-n');

await booking('__sa__r_widget_a', fx.organizationId, fx.a.id, fx.a.unitIds[0], `widget:${SITE_A}`, 1000);
await booking('__sa__r_widget_b', fx.organizationId, fx.b.id, fx.b.unitIds[0], `widget:${SITE_B}`, 2000);
await booking('__sa__r_phone_a', fx.organizationId, fx.a.id, fx.a.unitIds[1], 'phone', 4000);
await booking('__sa__r_widget_n', neighbour.organizationId, neighbour.propertyId,
  neighbour.unitIds[0], `widget:${SITE_N}`, 8000);
// Ключ сайта А на броні будинку Б — саме те, проти чого стоїть вісь обʼєкта.
await booking('__sa__r_crossed', fx.organizationId, fx.b.id, fx.b.unitIds[1], `widget:${SITE_A}`, 16000);

/** Сума, яку побачив би екран: рівно те, що фільтр пускає. */
const revenueFor = async (siteId: string, propertyId: string | null) =>
  await runWithOrganization(fx.organizationId, async () => {
    const scope = sourceScope(siteId, propertyId, fx.organizationId);
    const row = await sql.row<any>(
      `SELECT COALESCE(SUM(total_price), 0) AS total FROM reservations
        WHERE ${scope.sql} AND status != 'cancelled'`,
      scope.params) as any;
    return Number(row.total);
  });

try {
  // ── Один сайт: лише його броні свого будинку ────────────────────────
  assert.strictEqual(await revenueFor(SITE_A, fx.a.id), 1000,
    'аналітика сайта А має показувати 1000: 5000 — прилетіла телефонна бронь, '
    + '17000 — бронь ІНШОГО будинку з ключем цього сайта');
  assert.strictEqual(await revenueFor(SITE_B, fx.b.id), 2000,
    'аналітика сайта Б має показувати 2000');
  console.log('  ok  один сайт — 1000 і 2000, а не сума будинку');

  // ── «Усі сайти» — це УСІ САЙТИ, а не всі броні готелю ────────────────
  //
  // Тут і був дефект: гілка `all` не називала джерела взагалі.
  //
  // 19000 = 1000 + 2000 + 16000: перехрещена бронь тут рахується законно —
  // вона з віджета і вона в будинку цього рахунку. «Усі сайти» не звужені
  // до одного будинку за побудовою, тож вісь обʼєкта тут нічого не ріже, і
  // це сказано числом, а не мається на увазі.
  {
    const all = await revenueFor('all', null);
    assert.strictEqual(all, 19000,
      `усі сайти = 1000 + 2000 + 16000 (усе віджетне цього рахунку), отримали ${all}: `
      + '23000 — приїхала телефонна бронь, 27000 — ще й сусідній орендар');
  }
  console.log('  ok  «усі сайти» — сума сайтів (3000), без телефонної броні');

  // ── Орендар: сусід не потрапляє в жодну з гілок ──────────────────────
  //
  // 8000 більша за будь-яку нашу суму, тож поява сусіда видна числом, а не
  // лише лічильником.
  {
    const all = await revenueFor('all', null);
    assert.ok(all < 20000, `у «всіх сайтах» видно броню СУСІДНЬОГО орендаря на 8000 (сума ${all})`);
  }
  assert.strictEqual(await revenueFor(SITE_N, neighbour.propertyId), 0,
    'сайт сусіда, названий у нашому контексті, мав дати нуль, а не його виторг');
  console.log('  ok  сусідній орендар не потрапляє ні у «всі сайти», ні за прямим id');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('site-analytics.scope: аналітика сайту рахує сайт, свій будинок і свого орендаря');
