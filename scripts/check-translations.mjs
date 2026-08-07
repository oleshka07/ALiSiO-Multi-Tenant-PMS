/**
 * How much of the interface a language actually covers.
 *
 *   node scripts/check-translations.mjs
 *   node scripts/check-translations.mjs --missing de   # what is left, most-used first
 *
 * Two failure modes this exists to catch, both of which look like progress:
 *
 *   dead entries — a translation whose Ukrainian key is no longer anywhere in
 *   the source. It inflates the dictionary and translates nothing. Usually the
 *   original text was edited and the entry was not.
 *
 *   untranslated — the honest number. The runtime falls back to Ukrainian, so
 *   a missing entry is invisible from the inside; the only way to know the
 *   interface is half German is to count.
 *
 *   missing plural forms — a key used with `plural(n, …)` whose entry does not
 *   cover every form the language needs. German gets away with two; Czech and
 *   Polish need three, and the missing one shows up only on the counts that hit
 *   it. Which forms a language requires comes from Intl.PluralRules, so adding
 *   a language does not mean editing a table here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pluralKeys } from './lib/plural-keys.mjs';

const MESSAGES = 'src/core/i18n/messages';
const catalogue = JSON.parse(fs.readFileSync(path.join(MESSAGES, 'catalogue.json'), 'utf8'));
const known = new Set(catalogue);

const argv = process.argv.slice(2);
const missingFor = argv.includes('--missing') ? argv[argv.indexOf('--missing') + 1] : null;

const languages = fs
  .readdirSync(MESSAGES)
  .filter((f) => f.endsWith('.json') && f !== 'catalogue.json')
  .map((f) => f.replace('.json', ''));

let failed = false;
const plurals = pluralKeys();

for (const lang of languages) {
  const dict = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${lang}.json`), 'utf8'));
  const keys = Object.keys(dict);
  const dead = keys.filter((k) => !known.has(k));
  const live = keys.length - dead.length;
  const percent = ((live / catalogue.length) * 100).toFixed(1);

  console.log(`${lang}: ${live} із ${catalogue.length} — ${percent}%`);

  if (dead.length) {
    failed = true;
    console.log(`  мертвих записів: ${dead.length} (ключа немає у джерелі)`);
    for (const k of dead.slice(0, 10)) console.log(`    ${JSON.stringify(k)}`);
    if (dead.length > 10) console.log(`    …ще ${dead.length - 10}`);
  }

  // A plural key whose entry is a bare string can only ever render one form.
  // Which forms are required is the language's business, not ours.
  const required = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  const wrong = [];
  for (const key of plurals) {
    const entry = dict[key];
    if (entry === undefined) continue; // already counted as untranslated
    if (typeof entry === 'string') {
      wrong.push([key, `один рядок замість форм: ${required.join(', ')}`]);
      continue;
    }
    const absent = required.filter((c) => !entry[c]);
    if (absent.length) wrong.push([key, `нема форм: ${absent.join(', ')}`]);
  }
  if (wrong.length) {
    failed = true;
    console.log(`  без форм множини: ${wrong.length}`);
    for (const [k, why] of wrong.slice(0, 10)) console.log(`    ${JSON.stringify(k)} — ${why}`);
    if (wrong.length > 10) console.log(`    …ще ${wrong.length - 10}`);
  }

  if (missingFor === lang) {
    const missing = catalogue.filter((k) => !(k in dict));
    console.log(`\n  неперекладених: ${missing.length}`);
    // Short strings first: they are the buttons and labels that repeat on
    // every screen, so they buy the most visible coverage per entry.
    for (const k of missing.sort((a, b) => a.length - b.length).slice(0, 60)) {
      console.log(`    ${JSON.stringify(k)}: "",`);
    }
  }
}

if (failed) {
  console.log(
    '\nМертві записи й неповні форми множини не ламають збірку, але вони — брехня про\n' +
      'покриття: перше рахує неіснуюче, друге показує «1 Einträge».',
  );
  process.exit(1);
}
