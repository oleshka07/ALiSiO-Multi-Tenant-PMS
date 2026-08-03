/**
 * Calendar row grouping.
 *
 *   node "src/app/app/(dashboard)/calendar/grouping.check.ts"
 *
 * The bug that made this file exist: group NAMES were built with a fallback
 * (`building_name || 'Other'`) while group MEMBERS were matched without one
 * (`building_name === 'Other'`). A hotel that names no buildings — the normal
 * case — got a calendar with the right group headers and zero rooms under
 * them. Nothing failed, nothing logged; the screen was just empty.
 *
 * The invariant, and the only one that matters: every unit handed in comes
 * back out in exactly one group. Copy of the logic in page.tsx — a client
 * component cannot be imported here, so the check guards the shape of the
 * rule, and page.tsx carries the same function.
 */
import assert from 'node:assert';

type Unit = {
  id: string;
  category_type: string;
  building_name?: string | null;
  zone?: string | null;
};

const LABELS: Record<string, string> = { glamping: 'Glamping', resort: 'Resort', camping: 'Camping' };

function groupUnits(units: Unit[]) {
  const groupOf = (u: Unit) => {
    const sub = u.building_name || u.zone || '';
    const cat = LABELS[u.category_type] || u.category_type || 'Номери';
    return sub ? { key: `${u.category_type}/${sub}`, label: `${cat} / ${sub}` }
               : { key: u.category_type || 'all', label: cat };
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

// The exact shape that rendered an empty calendar: rooms, no buildings named.
const noBuildings: Unit[] = [
  { id: 'u1', category_type: 'resort', building_name: null, zone: null },
  { id: 'u2', category_type: 'resort', building_name: null, zone: null },
];
assertEveryUnitPlaced(noBuildings, 'resort without buildings');
assert.strictEqual(groupUnits(noBuildings).length, 1, 'one category, no buildings → one group');

// Buildings named — one group each, and the units inside them.
const withBuildings: Unit[] = [
  { id: 'a', category_type: 'resort', building_name: 'A' },
  { id: 'b', category_type: 'resort', building_name: 'B' },
  { id: 'c', category_type: 'resort', building_name: 'B' },
];
assertEveryUnitPlaced(withBuildings, 'resort with buildings');
assert.strictEqual(groupUnits(withBuildings).length, 2);

// Camping groups by zone through the same path.
assertEveryUnitPlaced([
  { id: 'z1', category_type: 'camping', zone: 'Ліс' },
  { id: 'z2', category_type: 'camping', zone: null },
], 'camping by zone');

// A category the code has never heard of must still render.
const unknown: Unit[] = [{ id: 'x', category_type: 'hostel', building_name: null }];
assertEveryUnitPlaced(unknown, 'unknown category');
assert.strictEqual(groupUnits(unknown)[0].label, 'hostel', 'unknown category keeps its own name');

// Mixed, including a unit whose category is missing entirely.
assertEveryUnitPlaced([
  { id: 'm1', category_type: 'resort', building_name: 'A' },
  { id: 'm2', category_type: 'camping', zone: 'Пляж' },
  { id: 'm3', category_type: 'glamping' },
  { id: 'm4', category_type: '' as string },
], 'mixed');

assert.strictEqual(groupUnits([]).length, 0, 'no units → no groups');

console.log('calendar grouping: every unit lands in exactly one non-empty group');
