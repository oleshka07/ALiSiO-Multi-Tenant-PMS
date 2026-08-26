/**
 * Every API path an embed script calls must exist.
 *
 *   node scripts/check-embed-routes.mjs --strict
 *
 * The scripts under `public/widget/` live on OTHER people's websites. Nothing
 * compiles them, nothing type-checks them, and when a route is renamed they go
 * on calling the old name until a guest notices — which, three times over,
 * meant nobody noticed at all:
 *
 *   collector.js posted every contact form to /api/public/capture, a route
 *   that did not exist. Its own catch swallowed the 404, so the guest saw
 *   «дякуємо» and the hotel never received the enquiry.
 *
 *   service-embed.js asked /api/booking/promo to validate coupons. The route
 *   had been renamed to /api/booking/activate, so every code a hotel issued
 *   was rejected by that hotel's own widget as «Invalid».
 *
 *   the same file posted to /api/booking/checkout-session, deleted with the
 *   Teya integration, so the last button of the flow answered «Payment init
 *   failed» to a guest who had just decided to spend money.
 *
 * All three are the same bug: a string in a file no compiler reads, naming a
 * route that has moved. This gate reads the strings and looks for the routes.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const WIDGET_DIR = 'public/widget';
const API_DIR = 'src/app/api';

/**
 * Built bundles are skipped, and the skip is named rather than silent.
 *
 * `native-bundle.js` is 300 KB of compiled React whose source is not in this
 * repository, so it cannot be rebuilt and its calls cannot be corrected here.
 * It still references /api/booking/checkout-session. That is a real problem
 * and it belongs to whoever decides the fate of the «native» embed — not to a
 * gate that would fail on every commit until then. Listing it here keeps it
 * visible; deleting this line when the bundle goes is the whole cleanup.
 */
const UNMAINTAINABLE = new Map([
  ['native-bundle.js', 'compiled bundle, no source in this repository — see docs/AUDIT.md §2.6'],
]);

/** Every route file on disk, as the URL path it answers. */
function routePaths() {
  const found = new Set();
  const walk = (dir, url) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // [id] and [...path] match anything in that position.
        const segment = entry.name.startsWith('[') ? '*' : entry.name;
        walk(full, `${url}/${segment}`);
      } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
        found.add(url);
      }
    }
  };
  walk(API_DIR, '/api');
  return found;
}

/** Does this URL match a route, allowing for [id] segments? */
function matches(url, routes) {
  if (routes.has(url)) return true;
  const parts = url.split('/');
  for (const route of routes) {
    const rp = route.split('/');
    if (rp.length !== parts.length) continue;
    if (rp.every((seg, i) => seg === '*' || seg === parts[i])) return true;
  }
  return false;
}

const routes = routePaths();
const problems = [];
const skipped = [];

for (const file of fs.readdirSync(WIDGET_DIR)) {
  if (!file.endsWith('.js')) continue;
  if (UNMAINTAINABLE.has(file)) { skipped.push(`${file} — ${UNMAINTAINABLE.get(file)}`); continue; }

  const source = fs.readFileSync(path.join(WIDGET_DIR, file), 'utf8');
  // Comments explain the routes that USED to be called; a gate that cannot
  // tell an explanation from a call would fail on its own documentation.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const seen = new Set();
  for (const [, url] of code.matchAll(/['"`](\/api\/[A-Za-z0-9_\-/[\]]*)/g)) {
    // Trim a trailing separator left by string concatenation.
    const clean = url.replace(/\/$/, '');
    if (seen.has(clean)) continue;
    seen.add(clean);
    if (!matches(clean, routes)) problems.push(`${file}: ${clean}`);
  }
}

for (const s of skipped) console.log(`  ⊘ ${s}`);

if (problems.length) {
  console.error('\nembed-скрипт кличе маршрут, якого немає:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nЦі файли стоять на чужих сайтах. Ніхто їх не компілює, і про');
  console.error('404 дізнається лише гість — якщо взагалі дізнається.\n');
  if (STRICT) process.exit(1);
} else {
  console.log('embed-скрипти кличуть лише наявні маршрути');
}
