/**
 * Self-check for the configurable category step that replaced the retired
 * bespoke booking wizard's hardcoded glamping / buildings / camping branches.
 *
 * Run: npm run check
 */
import assert from 'node:assert';
import { groupUnitsByCategory } from './utils.ts';

type U = Parameters<typeof groupUnitsByCategory>[0][number];
const unit = (over: Partial<U> = {}): U => ({
  categoryId: 'cat_rooms',
  categoryName: 'Rooms',
  categoryIcon: '🏨',
  categoryColor: '#60a5fa',
  categorySort: 1,
  avgPricePerNight: 1800,
  ...over,
});

function testGroupsAndCounts() {
  const cats = groupUnitsByCategory([
    unit(),
    unit(),
    unit({ categoryId: 'cat_suites', categoryName: 'Suites', categorySort: 2, avgPricePerNight: 4200 }),
  ]);
  assert.strictEqual(cats.length, 2);
  assert.strictEqual(cats[0].id, 'cat_rooms');
  assert.strictEqual(cats[0].count, 2);
  assert.strictEqual(cats[1].id, 'cat_suites');
  assert.strictEqual(cats[1].count, 1);
  console.log('  ok  units group into their categories with correct counts');
}

function testCheapestWins() {
  const cats = groupUnitsByCategory([
    unit({ avgPricePerNight: 2600 }),
    unit({ avgPricePerNight: 1800 }),
    unit({ avgPricePerNight: 2200 }),
  ]);
  assert.strictEqual(cats[0].fromPrice, 1800, `fromPrice was ${cats[0].fromPrice}`);
  console.log('  ok  "from" price is the cheapest in the category');
}

function testUnpricedUnitsIgnored() {
  // A unit with no rate must not drag "from" down to 0 and advertise a free stay.
  const cats = groupUnitsByCategory([unit({ avgPricePerNight: 0 }), unit({ avgPricePerNight: 1500 })]);
  assert.strictEqual(cats[0].fromPrice, 1500, `fromPrice was ${cats[0].fromPrice}`);
  console.log('  ok  unpriced units never become a 0 "from" price');
}

function testSortOrderThenName() {
  const cats = groupUnitsByCategory([
    unit({ categoryId: 'c', categoryName: 'Zeta', categorySort: 5 }),
    unit({ categoryId: 'a', categoryName: 'Beta', categorySort: 1 }),
    unit({ categoryId: 'b', categoryName: 'Alpha', categorySort: 1 }),
  ]);
  assert.deepStrictEqual(cats.map((c) => c.name), ['Alpha', 'Beta', 'Zeta']);
  console.log('  ok  ordered by sort_order, then alphabetically');
}

function testUncategorisedIgnored() {
  // A mis-seeded row must not invent a nameless category in the guest UI.
  const cats = groupUnitsByCategory([unit(), { avgPricePerNight: 900 }]);
  assert.strictEqual(cats.length, 1);
  assert.strictEqual(cats[0].count, 1);
  console.log('  ok  units without a category are ignored, not bucketed');
}

function testSingleCategorySkipsStep() {
  // The step is shown only when length > 1; one category must stay one so the
  // guest of an ordinary hotel never sees a pointless screen.
  assert.strictEqual(groupUnitsByCategory([unit(), unit(), unit()]).length, 1);
  assert.strictEqual(groupUnitsByCategory([]).length, 0);
  console.log('  ok  a single category (or none) leaves nothing to choose');
}

for (const t of [
  testGroupsAndCounts,
  testCheapestWins,
  testUnpricedUnitsIgnored,
  testSortOrderThenName,
  testUncategorisedIgnored,
  testSingleCategorySkipsStep,
]) {
  t();
}
console.log('category-step: all checks passed');
