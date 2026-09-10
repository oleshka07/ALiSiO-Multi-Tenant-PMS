/**
 * Ваучер належить БУДИНКУ — і в списку, і при погашенні (INC-029, INC-042).
 *
 *   node src/app/api/gift-cards/gift-card-scope.check.ts
 *
 * ── Дорожча половина: ПОГАШЕННЯ ─────────────────────────────────────────
 *
 * `gift_cards.property_id` — `NOT NULL`: ваучер продано будинком, і той будинок
 * винен послугу. `POST /api/gift-cards/[id]/activate` брав `reservation_id` із
 * тіла запиту і звіряв бронь лише з РАХУНКОМ:
 *
 *     FROM reservations r JOIN properties p ON p.id = r.property_id
 *      WHERE r.id = ? AND p.organization_id = ?
 *
 * Над цим стояв коментар «one hotel's voucher could be redeemed against another
 * hotel's booking» — правдивий про сусідній рахунок і хибний про сусідній
 * будинок того самого рахунку. Ваучер обʼєкта А гасився проти броні обʼєкта Б,
 * без помилки й без сліду.
 *
 * Це не «видно зайве», це ГРОШІ: зобовʼязання одного будинку закриває виручку
 * іншого, і переказу між ними немає в жодних книгах. Той самий рід, що INC-034
 * (сайт обʼєкта А продавав номер обʼєкта Б), і той самий маркер: коментар, який
 * називає полагоджену половину.
 *
 * ── Дешевша половина: СПИСОК ────────────────────────────────────────────
 *
 * Обмеження в списку БУЛО і воно ж було шпариною: `propertyId` з адреси йшов у
 * фільтр без перевірки власності, тож чужий обʼєкт давав ПОРОЖНІЙ список
 * замість 404, а слово `all` приїхало б у фільтр ідентифікатором (Д49). Плюс
 * розкол імен — читалось `propertyId`, а решта екранів шле `property_id`
 * (NAMING §8): екран, переведений «як усі», не змінив би нічого.
 *
 * ── І одна знахідка, яка не про вісь ────────────────────────────────────
 *
 * Маршрут віддавав `{ gift_cards: … }`, а ЄДИНИЙ його читач
 * (`SiteGiftCardsTab.tsx:78`) читає `d.giftCards`. Тобто список ваучерів на
 * вкладці сайта не показував нічого й ніколи, і лічильник вкладки лишався
 * нулем. Ключ приведено до решти родини (`giftCard` у `POST`, `[id]`,
 * `activate`), і твердження про ФОРМУ відповіді стоїть нижче — інакше та сама
 * вада повернеться наступним перейменуванням.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Ваучерів 3 в А і 4 у Б — 3/4/7, жодна сума не дорівнює доданку. Номінали
 * теж різні (500 і 1250), тож «узяв чужий список» видно і сумою, і кодом, який
 * несе букву обʼєкта. Погашення перевіряється з ОБОХ боків: своя бронь мусить
 * пройти, інакше «чужу відмовлено» істинне й на маршруті, який відмовляє
 * завжди.
 *
 * ── Чого тут немає ──────────────────────────────────────────────────────
 *
 * Сцени на виклик БЕЗ жодного параметра області. `actorPropertyScope` тоді
 * питає куку через `cookies()`, а той поза запитом Next кидає — та сама межа,
 * що робить недосяжними самі загорнуті маршрути. Обидва тіла тому винесені в
 * іменовані експортовані функції, а сцена завжди називає або `site_id`, або
 * `property_id`.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-gift-card-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { listGiftCards } = await import('./route.ts');
const { activateGiftCard } = await import('./[id]/activate/route.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const CARDS_A = 3;
const CARDS_B = 4;
const VALUE_A = 500;
const VALUE_B = 1250;

await runWithOrganization(fx.organizationId, async () => {
  for (const [slug, propertyId] of [
    ['__gc__site_a', fx.a.id], ['__gc__site_b', fx.b.id],
  ] as const) {
    await sql.run(
      `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [slug, fx.organizationId, propertyId, `Site ${propertyId}`, slug]);
  }

  let n = 0;
  for (const [side, propertyId, count, value] of [
    ['A', fx.a.id, CARDS_A, VALUE_A], ['B', fx.b.id, CARDS_B, VALUE_B],
  ] as const) {
    for (let i = 1; i <= count; i++) {
      n += 1;
      await sql.run(
        `INSERT INTO gift_cards (id, organization_id, property_id, code, name, face_value, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [`__gc__${side}${i}`, fx.organizationId, propertyId, `GC-${side}-${n}`, `Ваучер ${side}`, value]);
    }
  }
});

const ALL_CARDS = CARDS_A + CARDS_B;
say(CARDS_A !== CARDS_B && ALL_CARDS !== CARDS_A && ALL_CARDS !== CARDS_B && VALUE_A !== VALUE_B,
  `ваучери несумісні: А=${CARDS_A}×${VALUE_A}, Б=${CARDS_B}×${VALUE_B}, усі=${ALL_CARDS}`);

const actor = { organizationId: fx.organizationId } as never;

const list = (query: string) => runWithOrganization(fx.organizationId, async () => {
  const url = `http://local/api/gift-cards?${query}`;
  const res = await listGiftCards({ url } as never, null as never, actor) as Response;
  const body = await res.json() as { giftCards?: { code: string; face_value: number }[] };
  return { status: res.status, cards: body.giftCards || [], body };
});

// ── Список: форма відповіді ───────────────────────────────────────────────
//
// Ключ — теж твердження. Читач один, і він читає `giftCards`.

const shapeProbe = await list(`site_id=__gc__site_a`);
say(Array.isArray((shapeProbe.body as Record<string, unknown>).giftCards),
  `список віддає ключ giftCards (ключі: ${Object.keys(shapeProbe.body).join(', ')})`);

// ── Список: вкладка сайта називає обʼєкт САЙТОМ ───────────────────────────

say(shapeProbe.cards.length === CARDS_A,
  `на вкладці сайта обʼєкта А ${CARDS_A} ваучерів, отримали ${shapeProbe.cards.length}`);
say(!shapeProbe.cards.some((c) => c.code.startsWith('GC-B-')),
  'ваучерів обʼєкта Б на вкладці сайта А немає');

const siteB = await list('site_id=__gc__site_b');
say(siteB.cards.length === CARDS_B,
  `на вкладці сайта обʼєкта Б ${CARDS_B} ваучерів, отримали ${siteB.cards.length}`);
say(siteB.cards.reduce((s, c) => s + Number(c.face_value), 0) === CARDS_B * VALUE_B,
  `номінали обʼєкта Б у сумі ${CARDS_B * VALUE_B}, отримали ${siteB.cards.reduce((s, c) => s + Number(c.face_value), 0)}`);

// ── Список: канонічне імʼя параметра, і «усі» СКАЗАНЕ ─────────────────────

const byParam = await list(`property_id=${fx.a.id}`);
say(byParam.cards.length === CARDS_A,
  `?property_id=<А> дає ${CARDS_A}, отримали ${byParam.cards.length} — канонічне імʼя читається`);

const all = await list('property_id=all');
say(all.cards.length === ALL_CARDS,
  `сказане «усі обʼєкти» дає ${ALL_CARDS}, отримали ${all.cards.length}`);

// ── Список: чуже — 404, а не порожньо ─────────────────────────────────────

const alienProperty = await list('property_id=__two_props__not_ours');
say(alienProperty.status === 404,
  `чужий обʼєкт — 404, а не порожній список (статус ${alienProperty.status})`);

const alienSite = await list('site_id=__gc__site_not_ours');
say(alienSite.status === 404,
  `чужий сайт — 404, а не порожній список (статус ${alienSite.status})`);

// ── Погашення: своя бронь мусить пройти ───────────────────────────────────

const activate = (cardId: string, reservationId: string) =>
  runWithOrganization(fx.organizationId, async () => {
    const res = await activateGiftCard(
      { url: 'http://local/api/gift-cards/x/activate', json: async () => ({ reservation_id: reservationId }) } as never,
      { params: Promise.resolve({ id: cardId }) } as never, actor) as Response;
    const row = await sql.row<{ status: string; reservation_id: string | null }>(
      'SELECT status, reservation_id FROM gift_cards WHERE id = ?', [cardId]);
    return { status: res.status, row };
  });

const own = await activate('__gc__A1', fx.a.reservationIds[0]);
say(own.status === 200 && own.row?.status === 'activated',
  `ваучер обʼєкта А гаситься проти СВОЄЇ броні (статус ${own.status}, ваучер «${own.row?.status}»)`);

// ── Погашення: чужий будинок — 404, і рядок НЕ змінився ───────────────────
//
// Читання рядка назад тут не формальність: маршрут міг би віддати 404 після
// того, як `UPDATE` уже пройшов, і статусна перевірка цього не побачила б.

const across = await activate('__gc__A2', fx.b.reservationIds[0]);
say(across.status === 404,
  `ваучер обʼєкта А проти броні обʼєкта Б — 404, отримали ${across.status}`);
say(across.row?.status === 'active' && across.row?.reservation_id === null,
  `і сам ваучер лишився непогашеним (статус «${across.row?.status}», бронь ${across.row?.reservation_id ?? '—'})`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\ngift-card-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`gift-card-scope: список ${CARDS_A}/${CARDS_B}/${ALL_CARDS}, чуже — 404, ваучер гаситься лише у своєму будинку`);
assert.ok(true);
