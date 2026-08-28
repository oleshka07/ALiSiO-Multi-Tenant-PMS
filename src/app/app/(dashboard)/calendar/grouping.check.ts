/**
 * Calendar row grouping.
 *
 *   node "src/app/app/(dashboard)/calendar/grouping.check.ts"
 *
 * The bug that made this file exist: group NAMES were built with a fallback
 * (`sub || 'Other'`) while group MEMBERS were matched without one
 * (`sub === 'Other'`). A hotel that names no subgroups — the normal case —
 * got a calendar with the right group headers and zero rooms under them.
 * Nothing failed, nothing logged; the screen was just empty.
 *
 * The invariant, and the only one that matters: every unit handed in comes
 * back out in exactly one group. Copy of the logic in page.tsx — a client
 * component cannot be imported here, so the check guards the shape of the
 * rule, and page.tsx carries the same function.
 *
 * The second rule, added when the first real hotel was about to be onboarded:
 * the group is named by the hotel's OWN word for the category, never by the
 * type. `category_type` is a behaviour key with six possible values, and
 * labelling from it printed "Resort" over a Ukrainian hotel's rooms and merged
 * two categories that happen to share a type into one group. A hotel with
 * "Корпус А" and "Корпус Б" must see two groups with those names.
 *
 * The subgroup used to be `building_name || zone`. Buildings are gone — a
 * whole table, its CRUD and its own iCal channel type existed for one client's
 * "F", while the calendar was already doing the same job with `zone`, a free
 * text column the hotel fills in itself. One source, one column.
 */
import assert from 'node:assert';

type Unit = {
  id: string;
  category_type: string;
  category_name?: string | null;
  zone?: string | null;
};

function groupUnits(units: Unit[]) {
  const groupOf = (u: Unit) => {
    const sub = u.zone || '';
    const cat = u.category_name || u.category_type || 'Номери';
    return sub ? { key: `${cat}/${sub}`, label: `${cat} / ${sub}` }
               : { key: cat, label: cat };
  };
  const byKey = new Map<string, { key: string; label: string; units: Unit[] }>();
  for (const u of units) {
    const g = groupOf(u);
    if (!byKey.has(g.key)) byKey.set(g.key, { key: g.key, label: g.label, units: [] });
    byKey.get(g.key)!.units.push(u);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** No unit may be lost, and none may appear twice. */
function assertEveryUnitPlaced(units: Unit[], where: string) {
  const groups = groupUnits(units);
  const placed = groups.flatMap((g) => g.units.map((u) => u.id));
  assert.strictEqual(placed.length, units.length, `${where}: ${units.length} units in, ${placed.length} out`);
  assert.strictEqual(new Set(placed).size, units.length, `${where}: a unit landed in two groups`);
  for (const g of groups) assert.ok(g.units.length > 0, `${where}: empty group "${g.label}"`);
}

// The exact shape that rendered an empty calendar: rooms, no subgroup named.
const noZones: Unit[] = [
  { id: 'u1', category_type: 'resort', zone: null },
  { id: 'u2', category_type: 'resort', zone: null },
];
assertEveryUnitPlaced(noZones, 'resort without zones');
assert.strictEqual(groupUnits(noZones).length, 1, 'one category, no zones → one group');

// Zones named — one group each, and the units inside them. This is the case
// buildings used to cover: a hotel with two wings types "A" and "B" here.
const withZones: Unit[] = [
  { id: 'a', category_type: 'resort', zone: 'A' },
  { id: 'b', category_type: 'resort', zone: 'B' },
  { id: 'c', category_type: 'resort', zone: 'B' },
];
assertEveryUnitPlaced(withZones, 'resort with zones');
assert.strictEqual(groupUnits(withZones).length, 2);

// Camping goes down the same path — there is only one path now.
assertEveryUnitPlaced([
  { id: 'z1', category_type: 'camping', zone: 'Ліс' },
  { id: 'z2', category_type: 'camping', zone: null },
], 'camping by zone');

// A category the code has never heard of must still render.
const unknown: Unit[] = [{ id: 'x', category_type: 'hostel', zone: null }];
assertEveryUnitPlaced(unknown, 'unknown category');
assert.strictEqual(groupUnits(unknown)[0].label, 'hostel', 'unknown category keeps its own name');

// Mixed, including a unit whose category is missing entirely.
assertEveryUnitPlaced([
  { id: 'm1', category_type: 'resort', zone: 'A' },
  { id: 'm2', category_type: 'camping', zone: 'Пляж' },
  { id: 'm3', category_type: 'glamping' },
  { id: 'm4', category_type: '' as string },
], 'mixed');

assert.strictEqual(groupUnits([]).length, 0, 'no units → no groups');

console.log('calendar grouping: every unit lands in exactly one non-empty group');

// ─── The hotel's own vocabulary ─────────────────────────────────────────────
// Two categories sharing a type must not collapse into one group, and neither
// may be named after the type.
const twoCategoriesSameType: Unit[] = [
  { id: 'a1', category_type: 'resort', category_name: 'Корпус А', zone: null },
  { id: 'b1', category_type: 'resort', category_name: 'Корпус Б', zone: null },
];
assertEveryUnitPlaced(twoCategoriesSameType, 'two categories, one type');
const twoGroups = groupUnits(twoCategoriesSameType);
assert.strictEqual(twoGroups.length, 2, 'two categories of one type stay two groups');
assert.deepStrictEqual(
  twoGroups.map((g) => g.label).sort(),
  ['Корпус А', 'Корпус Б'],
  'the group is named by the category, not by its type',
);
assert.ok(
  !twoGroups.some((g) => /resort|glamping|camping/i.test(g.label)),
  "no hotel may be shown another's vocabulary",
);

// A category with no name falls back to the type rather than disappearing.
const unnamed: Unit[] = [{ id: 'x', category_type: 'camping', category_name: null }];
assertEveryUnitPlaced(unnamed, 'category without a name');

console.log('  ok  групи звуться словами готелю, а не типом');
