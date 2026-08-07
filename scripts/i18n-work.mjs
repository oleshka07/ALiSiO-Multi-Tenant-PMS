/**
 * Hand a language out to be translated, and take it back with checks.
 *
 *   npm run i18n:export -- cs     # what is missing → .i18n-work/cs.json
 *   …fill it in…
 *   npm run i18n:apply  -- cs     # validate and merge into messages/cs.json
 *
 * No API key, no network, no cost. Who fills the file is left open on purpose:
 * an agent with the product in context (which is how German was written), a
 * person, or an agency working in their own tool. All three want the same
 * thing — the missing strings, alone, in a shape that cannot be filled in
 * wrongly without being caught.
 *
 * This is deliberately NOT how `core/i18n/translate.ts` works, and the
 * difference is about who is present. A hotel saving its FAQ needs that text
 * translated for guests *at that moment*, with nobody watching — so it calls a
 * model at runtime and stores rows. The interface catalogue only changes when
 * a developer adds a screen, and a developer is by definition already there.
 * Paying an API to do what the person in the loop can do better was a habit
 * copied from the other path, not a decision.
 *
 * What `apply` refuses, so a bad file cannot become a bad screen:
 *
 *   - a key that is not in the catalogue (a typo, or text since deleted);
 *   - an empty translation, which would read as "translated" while showing
 *     nothing;
 *   - a plural key missing any form the language actually uses — the failure
 *     that only appears on the counts nobody tested.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pluralKeys } from './lib/plural-keys.mjs';

const MESSAGES = 'src/core/i18n/messages';
const WORK = '.i18n-work';
const SOURCE_LANGUAGE = 'uk';

const argv = process.argv.slice(2);
const mode = argv[0];
const lang = argv[1];

if (!['export', 'apply'].includes(mode) || !lang) {
  console.error('Використання: node scripts/i18n-work.mjs export|apply <мова>');
  process.exit(2);
}
if (lang === SOURCE_LANGUAGE) {
  console.error('Українська — це джерело, її не перекладають.');
  process.exit(2);
}

const catalogue = JSON.parse(fs.readFileSync(path.join(MESSAGES, 'catalogue.json'), 'utf8'));
const known = new Set(catalogue);
const plurals = pluralKeys();
const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;

const dictPath = path.join(MESSAGES, `${lang}.json`);
const dict = fs.existsSync(dictPath) ? JSON.parse(fs.readFileSync(dictPath, 'utf8')) : {};
const workPath = path.join(WORK, `${lang}.json`);

// ─── export ──────────────────────────────────────────────────────────────────
if (mode === 'export') {
  const missing = {};
  for (const k of catalogue) {
    if (plurals.has(k)) {
      // Already done only if every form is there — a partial entry is a hole.
      const entry = dict[k];
      if (entry && typeof entry === 'object' && categories.every((c) => entry[c])) continue;
      missing[k] = Object.fromEntries(categories.map((c) => [c, '']));
    } else {
      if (typeof dict[k] === 'string' && dict[k]) continue;
      missing[k] = '';
    }
  }

  const count = Object.keys(missing).length;
  if (!count) {
    console.log(`${lang}: нічого не бракує (${catalogue.length} рядків)`);
    process.exit(0);
  }

  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(workPath, `${JSON.stringify(missing, null, 2)}\n`);
  const pluralCount = Object.values(missing).filter((v) => typeof v === 'object').length;
  console.log(`${lang}: ${count} рядків → ${workPath}`);
  console.log(`  з них із формами множини: ${pluralCount} (${categories.join(', ')})`);
  console.log(`\nЗаповніть значення, потім: npm run i18n:apply -- ${lang}`);
  process.exit(0);
}

// ─── apply ───────────────────────────────────────────────────────────────────
if (!fs.existsSync(workPath)) {
  console.error(`Немає ${workPath}. Спершу: npm run i18n:export -- ${lang}`);
  process.exit(2);
}

const filled = JSON.parse(fs.readFileSync(workPath, 'utf8'));
const problems = [];
const accepted = {};

for (const [key, value] of Object.entries(filled)) {
  if (!known.has(key)) {
    problems.push([key, 'такого ключа немає в каталозі']);
    continue;
  }
  if (plurals.has(key)) {
    if (typeof value !== 'object' || value === null) {
      problems.push([key, `потрібні форми: ${categories.join(', ')}`]);
      continue;
    }
    const absent = categories.filter((c) => typeof value[c] !== 'string' || !value[c].trim());
    if (absent.length) {
      problems.push([key, `нема форм: ${absent.join(', ')}`]);
      continue;
    }
    accepted[key] = Object.fromEntries(categories.map((c) => [c, value[c].trim()]));
  } else {
    if (typeof value !== 'string') {
      problems.push([key, 'має бути рядок']);
      continue;
    }
    if (!value.trim()) continue; // left blank on purpose — simply not applied
    accepted[key] = value;
  }
}

if (problems.length) {
  console.error(`✗ не прийнято: ${problems.length}\n`);
  for (const [k, why] of problems.slice(0, 20)) console.error(`  ${JSON.stringify(k)} — ${why}`);
  if (problems.length > 20) console.error(`  …ще ${problems.length - 20}`);
  console.error('\nНічого не записано.');
  process.exit(1);
}

Object.assign(dict, accepted);

// Catalogue order, so the diff reads like the product and a re-run moves nothing.
const ordered = {};
for (const k of catalogue) if (k in dict) ordered[k] = dict[k];
for (const k of Object.keys(dict)) if (!(k in ordered)) ordered[k] = dict[k];
fs.writeFileSync(dictPath, `${JSON.stringify(ordered, null, 2)}\n`);

const done = catalogue.filter((k) => k in ordered).length;
const blank = Object.values(filled).filter((v) => typeof v === 'string' && !v.trim()).length;
console.log(`✓ ${lang}: прийнято ${Object.keys(accepted).length}, разом ${done} із ${catalogue.length}`);
if (blank) console.log(`  лишено порожніми: ${blank}`);
console.log(`  записано: ${dictPath}`);
