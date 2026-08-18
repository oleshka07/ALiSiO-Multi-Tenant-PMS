/**
 * The section registry's merge rules — the contract the settings screen and
 * the guest page both lean on.
 *
 *   node src/modules/guests/domain/guest-page-sections.check.ts
 *
 * The two claims that matter most:
 *
 *   no rows = the page as it was. This mechanism shipped onto live hotels,
 *   and "enabling it must not move a pixel" is a promise to them, not a
 *   default that happens to be true today.
 *
 *   a German property cannot toggle its registration section away. The
 *   Meldeschein is §§28–30 BMG; a settings switch that could disable it
 *   would make the hotel non-compliant one well-meaning click at a time.
 */
import assert from 'node:assert';
import { resolveSections, GUEST_PAGE_SECTIONS, isKnownSection } from './guest-page-sections.ts';

// ── no rows = registry defaults, every section present ──────────────────────
const bare = resolveSections([], { propertyCountry: 'DE' });
assert.strictEqual(bare.length, GUEST_PAGE_SECTIONS.length, 'секція зникла без жодного рядка');
assert.ok(bare.every((s) => s.enabled), 'без рядків щось вимкнулось саме');
assert.strictEqual(bare[0].key, 'hero', 'hero не перший за замовчуванням');
console.log(`  ok  без рядків — усі ${bare.length} секцій, у порядку реєстру`);

// ── a hotel switches a section off ──────────────────────────────────────────
const noRestaurant = resolveSections(
  [{ section: 'restaurant', enabled: 0, sort_order: null, config: null }],
  { propertyCountry: 'DE' });
assert.strictEqual(noRestaurant.find((s) => s.key === 'restaurant')?.enabled, false);
assert.ok(noRestaurant.find((s) => s.key === 'faq')?.enabled, 'вимкнення однієї зачепило сусідню');
console.log('  ok  вимкнена секція вимкнена, сусідні неторкнуті');

// ── the law does not have an off switch ─────────────────────────────────────
const lawless = resolveSections(
  [{ section: 'registration', enabled: 0, sort_order: null, config: null }],
  { propertyCountry: 'DE' });
const reg = lawless.find((s) => s.key === 'registration')!;
assert.strictEqual(reg.enabled, true, 'німецький готель вимкнув Meldeschein галочкою');
assert.strictEqual(reg.locked, 'jurisdiction', 'екран налаштувань не дізнається, чому перемикач мертвий');

// …but a country without the duty may.
const free = resolveSections(
  [{ section: 'registration', enabled: 0, sort_order: null, config: null }],
  { propertyCountry: 'ES' });
assert.strictEqual(free.find((s) => s.key === 'registration')?.enabled, false);
console.log('  ok  реєстрацію не вимкнути в DE, можна в ES');

// hero is structural everywhere.
const noHero = resolveSections(
  [{ section: 'hero', enabled: 0, sort_order: null, config: null }],
  { propertyCountry: 'ES' });
assert.strictEqual(noHero.find((s) => s.key === 'hero')?.enabled, true, 'сторінку лишили без хребта');
console.log('  ok  hero структурний — не вимикається ніде');

// ── reorder, unknown keys, broken config ────────────────────────────────────
const reordered = resolveSections(
  [{ section: 'faq', enabled: 1, sort_order: 15, config: '{"title":"Fragen"}' },
   { section: 'zombie_section', enabled: 1, sort_order: 1, config: null },
   { section: 'rules', enabled: 1, sort_order: null, config: 'not json' }],
  { propertyCountry: 'DE' });
assert.strictEqual(reordered[1].key, 'faq', 'sort_order 15 не поставив faq одразу після hero');
assert.ok(!reordered.some((s) => (s.key as string) === 'zombie_section'),
  'рядок для секції, якої немає в реєстрі, дожив до відповіді');
assert.deepStrictEqual(reordered[1].config, { title: 'Fragen' });
assert.deepStrictEqual(reordered.find((s) => s.key === 'rules')?.config, {},
  'битий JSON має ставати порожнім конфігом, не помилкою');
assert.ok(!isKnownSection('zombie_section'));
console.log('  ok  порядок перекривається, невідомі ключі падають, битий JSON нешкідливий');

console.log('реєстр секцій: без рядків — та сама сторінка; закон і хребет не вимикаються');
