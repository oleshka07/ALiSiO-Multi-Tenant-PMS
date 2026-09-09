/**
 * Новий готель отримує СВІЙ часовий пояс, а не чеський.
 *
 *   node src/core/provisioning-timezone.check.ts
 *
 * ── Навіщо ця перевірка існує ───────────────────────────────────────────
 *
 * Вендор каналу перед продакшном каже прямо: «Make sure you set property type
 * and timezone when you create a property». Пояс тут не етикетка — він
 * вирішує, ДЕ ПРОХОДИТЬ МЕЖА ДОБИ, а канал торгує датами заїзду. Зсунута
 * межа це зсунута бронь: гість, який заїжджає «сьогодні», приїжджає в день,
 * якого готель не продавав.
 *
 * У `provisionOrganization` стояло `input.timezone || 'Europe/Prague'` — той
 * самий клас, що `input.currency || 'CZK'`, який зробив чеським кожен
 * готель, заведений без `--currency` (див. `currency.check.ts`). Для
 * українського готелю Прага помиляється на годину цілий рік, і жодної
 * помилки при цьому ніхто не бачить: колонка заповнена, значення схоже на
 * правду.
 *
 * ── Чому фікстура з ДВОХ країн ──────────────────────────────────────────
 *
 * Інваріант 26. Один готель у Чехії лишає твердження зеленим і з поясом, і
 * без нього: `'Europe/Prague'` — правильна відповідь для нього обома
 * шляхами. Вісь зʼявляється лише тоді, коли поруч стоїть готель, для якого
 * дефолт НЕПРАВИЛЬНИЙ, і числа арифметично несумісні: Київ ≠ Прага.
 *
 * ── Що було червоним ────────────────────────────────────────────────────
 *
 * На коді до правки твердження про український готель падало словами
 * «пояс готелю — його власний, не дефолт схеми (поїхало: Europe/Prague)»,
 * а твердження про відмову — тим, що заведення без пояса й без країни
 * ПРОХОДИЛО. Обидва — на справжньому виклику `provisionOrganization`, а не
 * на читанні коду.
 */
import assert from 'node:assert';
import '../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { provisionOrganization } = await import('./provisioning.ts');
const { timezoneForCountry } = await import('./hotel-day.ts');

const sql = getSql();
const SLUGS = ['probe-tz-ua', 'probe-tz-cz', 'probe-tz-explicit'];
const PASSWORD = 'probe-timezone-password';

/**
 * Прибирання називає кількість (Ц49).
 *
 * Заведення пише в шість таблиць, і рядки знімаються В КОНТЕКСТІ орендаря —
 * як це робить застосунок: під роллю застосунку тенантний `DELETE` без
 * орендаря не падає, він просто чіпає нуль рядків.
 */
async function cleanup() {
  for (const slug of SLUGS) {
    const org = await sql.row<{ id: string }>('SELECT id FROM organizations WHERE slug = ?', [slug]);
    if (!org) continue;
    await runWithOrganization(org.id, async () => {
      const props = await sql.rows<{ id: string }>(
        'SELECT id FROM properties WHERE organization_id = ?', [org.id]);
      for (const p of props) {
        await sql.run('DELETE FROM booking_sources WHERE property_id = ?', [p.id]);
        await sql.run('DELETE FROM categories WHERE property_id = ?', [p.id]);
      }
      await sql.run('DELETE FROM organization_features WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM app_users WHERE organization_id = ?', [org.id]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org.id]);
    });
    // На `organizations` політики немає за побудовою — цей рядок знімається
    // поза контекстом.
    await sql.run('DELETE FROM organizations WHERE id = ?', [org.id]);
  }
}

/** Пояс, який реально ліг у базу цьому готелю. */
async function storedTimezone(organizationId: string): Promise<string | null> {
  const row = await sql.row<{ timezone: string }>(
    'SELECT timezone FROM organizations WHERE id = ?', [organizationId]);
  return row?.timezone ?? null;
}

await cleanup();

// ── Мапа країн: два різні значення, і вони несумісні ─────────────────────
assert.equal(timezoneForCountry('UA'), 'Europe/Kyiv', 'Україна — Київ');
assert.equal(timezoneForCountry('cz'), 'Europe/Prague', 'реєстр не чутливий до регістру');
assert.equal(timezoneForCountry('US'), null,
  'країна з кількома поясами не вгадується — США мають повернути null');
assert.equal(timezoneForCountry('ZZ'), null, 'невідома країна — null, не дефолт');

// ── Готель в Україні ─────────────────────────────────────────────────────
const ua = await provisionOrganization({
  name: 'Probe TZ UA', slug: 'probe-tz-ua',
  ownerEmail: 'probe-tz-ua@probe.test', ownerPassword: PASSWORD,
  currency: 'UAH', language: 'uk', country: 'UA', lodgingKind: 'hotel',
});
const uaZone = await storedTimezone(ua.organizationId);
assert.equal(uaZone, 'Europe/Kyiv',
  `пояс готелю — його власний, не дефолт схеми (поїхало: ${uaZone})`);
assert.equal(ua.timezone, 'Europe/Kyiv', 'заведення повертає пояс, який поставило');
assert.equal(ua.timezoneFrom, 'country',
  'і каже, ЗВІДКИ він — інакше оператор не знає, що це висновок, а не його слово');

// ── Сусід у Чехії ────────────────────────────────────────────────────────
const cz = await provisionOrganization({
  name: 'Probe TZ CZ', slug: 'probe-tz-cz',
  ownerEmail: 'probe-tz-cz@probe.test', ownerPassword: PASSWORD,
  currency: 'CZK', language: 'cs', country: 'CZ', lodgingKind: 'hotel',
});
const czZone = await storedTimezone(cz.organizationId);
assert.equal(czZone, 'Europe/Prague', `сусід поїхав своїм поясом (${czZone})`);
assert.notEqual(uaZone, czZone,
  'вісь: два готелі в різних країнах мають різні пояси — інакше твердження вище зелене й без правки');

// ── Слово оператора сильніше за висновок ─────────────────────────────────
const explicit = await provisionOrganization({
  name: 'Probe TZ explicit', slug: 'probe-tz-explicit',
  ownerEmail: 'probe-tz-explicit@probe.test', ownerPassword: PASSWORD,
  currency: 'UAH', language: 'uk', country: 'UA', timezone: 'Europe/Warsaw',
  lodgingKind: 'hotel',
});
assert.equal(await storedTimezone(explicit.organizationId), 'Europe/Warsaw',
  'названий пояс перебиває виведений із країни');
assert.equal(explicit.timezoneFrom, 'input', 'і це не видається за висновок');

// ── Три відмови: мовчазного дефолту більше немає ─────────────────────────
//
// Рід житла тут названий у КОЖНОМУ виклику, і це не формальність. Після В1
// заведення відмовляє і без нього (`provisioning-lodging-kind.check.ts`), а
// його варта стоїть вище за поясову. Не назвавши рід, ці три твердження
// ловили б відмову ПРО РІД і були б зелені при будь-якому стані поясової
// варти — рівно те, від чого стереже §3.2.1: зелене твердження, яке більше
// не про свою вісь.
await assert.rejects(
  () => provisionOrganization({
    name: 'Probe TZ none', slug: 'probe-tz-none',
    ownerEmail: 'probe-tz-none@probe.test', ownerPassword: PASSWORD,
    currency: 'EUR', language: 'uk', lodgingKind: 'hotel',
  }),
  /timezone/,
  'ні пояса, ні країни — названа відмова, а не Прага',
);

await assert.rejects(
  () => provisionOrganization({
    name: 'Probe TZ multi', slug: 'probe-tz-multi',
    ownerEmail: 'probe-tz-multi@probe.test', ownerPassword: PASSWORD,
    currency: 'USD', language: 'en', country: 'US', lodgingKind: 'hotel',
  }),
  /timezone/,
  'країна з кількома поясами — відмова, а не перший-ліпший із них',
);

await assert.rejects(
  () => provisionOrganization({
    name: 'Probe TZ bogus', slug: 'probe-tz-bogus',
    ownerEmail: 'probe-tz-bogus@probe.test', ownerPassword: PASSWORD,
    currency: 'EUR', language: 'uk', timezone: 'Europe/Atlantis',
    lodgingKind: 'hotel',
  }),
  /timezone/,
  'вигаданий пояс не записується: `todayIn` мовчки падає з нього на UTC',
);

await cleanup();

// Прибирання, яке не має права мовчати (Ц49): якщо жоден із трьох рядків не
// зник, наступний прогін упаде на зайнятому slug — і причина виглядатиме як
// зламане заведення.
const left = await sql.rows<{ slug: string }>(
  `SELECT slug FROM organizations WHERE slug IN (${SLUGS.map(() => '?').join(',')})`, SLUGS);
assert.equal(left.length, 0, `після прибирання лишилось ${left.length} організацій: ${left.map(r => r.slug).join(', ')}`);

console.log('✓ provisioning-timezone: пояс нового готелю — його власний, і мовчазного дефолту немає');
