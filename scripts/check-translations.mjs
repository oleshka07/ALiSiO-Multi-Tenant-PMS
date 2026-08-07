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
 *   incomplete but offered — a language the product actually shows in the
 *   settings screen, with gaps in it. A language file that exists but is not
 *   registered in dictionary.ts is work in progress and only reported; one
 *   that IS registered has to be complete, because someone can pick it.
 *
 *   missing plural forms — a key used with `plural(n, …)` whose entry does not
 *   cover every form the language needs. German gets away with two; Czech and
 *   Polish need three, and the missing one shows up only on the counts that hit
 *   it. Which forms a language requires comes from Intl.PluralRules, so adding
 *   a language does not mean editing a table here.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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

/**
 * Which languages the product actually offers.
 *
 * Read out of dictionary.ts rather than kept beside it, because a second list
 * is a list that goes stale — and the failure would be "Czech is offered and
 * half empty", which is exactly what this is here to prevent.
 *
 * The name matters and has already bitten once: the registry was renamed from
 * DICTIONARIES to SOURCES when dictionaries became lazy, this kept reading the
 * old name, and for four commits it quietly required nothing of anybody. A
 * check that reads a name has to fail loudly when the name is gone.
 */
function offeredLanguages() {
  const file = 'src/core/i18n/dictionary.ts';
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const offered = new Set();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'SOURCES' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const p of node.initializer.properties) {
        if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
          offered.add(p.name.getText(source).replace(/['"]/g, ''));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!offered.size) {
    console.error(
      'check-translations: у dictionary.ts не знайдено реєстру SOURCES.\n' +
        'Перевірка не знає, які мови пропонуються, тому нічого не вимагає — це не «все добре».',
    );
    process.exit(2);
  }
  return offered;
}

const offered = offeredLanguages();

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

  const missing = catalogue.filter((k) => !(k in dict));
  if (missing.length && offered.has(lang)) {
    failed = true;
    console.log(`  неперекладених: ${missing.length} — мова вже пропонується користувачам`);
    console.log(`  заповнити: npm run i18n:export -- ${lang}`);
  } else if (missing.length) {
    console.log(`  неперекладених: ${missing.length} (мова ще не підключена в dictionary.ts)`);
  }

  if (missingFor === lang) {
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
