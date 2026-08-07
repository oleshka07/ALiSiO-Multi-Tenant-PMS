/**
 * Fill in what a language is missing, so nobody has to sit down and type it.
 *
 *   npm run i18n:translate -- cs          # fill Czech
 *   npm run i18n:translate -- cs en pl    # several
 *   npm run i18n:translate -- cs --dry    # say what it would do
 *
 * This is the answer to "does every new module mean another translation
 * session". It does not: you add a screen, run this, and read the diff. The
 * work becomes reviewing rather than writing, and `check:i18n` in CI makes
 * forgetting impossible rather than merely unlikely.
 *
 * Deliberately NOT the same path as core/i18n/translate.ts, which translates a
 * hotel's own content. Three things differ and each one matters:
 *
 *   - the source is always Ukrainian, never the organization's language: this
 *     is our interface, not a customer's text;
 *   - the result is a file in git, not a row in content_translations — a
 *     translation of the product should be reviewable in a diff, and should not
 *     need a database to render;
 *   - plural keys need every form the target language uses, which is a
 *     different question to ask a model than "translate this phrase".
 *
 * Output is written in catalogue order so the diff reads top to bottom and a
 * re-run moves nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pluralKeys } from './lib/plural-keys.mjs';

const MESSAGES = 'src/core/i18n/messages';
const SOURCE_LANGUAGE = 'uk';
const MODEL = 'gpt-4o-mini';
const BATCH = 25;

const NAMES = {
  uk: 'Ukrainian',
  en: 'English',
  de: 'German',
  cs: 'Czech',
  pl: 'Polish',
  nl: 'Dutch',
  fr: 'French',
};

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const force = argv.includes('--force');
const targets = argv.filter((a) => !a.startsWith('--'));

if (!targets.length) {
  console.error(`Вкажіть мову: ${Object.keys(NAMES).filter((l) => l !== SOURCE_LANGUAGE).join(' ')}`);
  process.exit(2);
}

const catalogue = JSON.parse(fs.readFileSync(path.join(MESSAGES, 'catalogue.json'), 'utf8'));
const plurals = pluralKeys();

const key = process.env.OPENAI_API_KEY;
if (!key && !dry) {
  console.error('OPENAI_API_KEY не заданий. Без нього можна лише --dry.');
  process.exit(2);
}

/**
 * The rules are the ones the content translator already learned the hard way:
 * an emoji dropped from a status badge and a price "translated" into words are
 * both silent damage.
 */
const RULES = `Rules:
- Keep every emoji exactly where it is.
- Preserve leading and trailing spaces, punctuation and brackets exactly.
- Do not translate: prices, currency codes, product names (Teya, Hostex, PriceLabs, Booking.com, Airbnb, iCal, CAPEX, ISDOC), field names in code style, URLs.
- This is a hotel management interface used by staff. Prefer the short, ordinary word a hotel employee would use, not a literal rendering.
- Return ONLY the translations, one per line, each prefixed with its index like [0] translation.`;

async function ask(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, messages }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** Plain phrases, in batches, indexed so a dropped line cannot shift the rest. */
async function translatePlain(texts, lang) {
  const out = new Map();
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const reply = await ask([
      {
        role: 'system',
        content: `You are a professional translator for hotel software. Translate from ${NAMES[SOURCE_LANGUAGE]} to ${NAMES[lang]}.\n${RULES}`,
      },
      { role: 'user', content: batch.map((t, n) => `[${n}] ${t}`).join('\n') },
    ]);
    for (const line of reply.split('\n')) {
      const m = line.match(/^\[(\d+)\]\s?(.*)$/);
      if (!m) continue;
      const n = Number(m[1]);
      const value = m[2].trim();
      if (n >= 0 && n < batch.length && value) out.set(batch[n], value);
    }
    console.log(`  ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
  }
  return out;
}

/**
 * Plural keys, asked for as JSON.
 *
 * Which categories to ask for comes from the language, so Czech is asked for
 * `few` without anyone remembering that Czech needs it.
 */
async function translatePlurals(texts, lang) {
  const out = new Map();
  const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  if (!texts.length) return out;

  const reply = await ask([
    {
      role: 'system',
      content: `You are a professional translator for hotel software. Translate from ${NAMES[SOURCE_LANGUAGE]} to ${NAMES[lang]}.

Each input is a noun phrase that follows a number ("5 записів"). ${NAMES[lang]} uses these plural categories: ${categories.join(', ')}. Give the form for each one — the phrase alone, WITHOUT the number.

${RULES.split('\n').slice(1, -1).join('\n')}
Return ONLY a JSON object: {"<source phrase>": {${categories.map((c) => `"${c}": "…"`).join(', ')}}, …}`,
    },
    { role: 'user', content: JSON.stringify(texts) },
  ]);

  const json = reply.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.error('  ! відповідь на множину не JSON, пропускаю цю партію');
    return out;
  }
  for (const text of texts) {
    const entry = parsed[text];
    if (!entry || typeof entry !== 'object') continue;
    const forms = {};
    for (const c of categories) if (typeof entry[c] === 'string' && entry[c].trim()) forms[c] = entry[c].trim();
    // A partial answer is worse than none: it would pass the shape check and
    // still render the wrong word on the counts it is missing.
    if (categories.every((c) => forms[c])) out.set(text, forms);
  }
  return out;
}

for (const lang of targets) {
  if (!NAMES[lang]) {
    console.error(`Невідома мова: ${lang}`);
    process.exit(2);
  }
  if (lang === SOURCE_LANGUAGE) {
    console.error('Українська — це джерело, її не перекладають.');
    process.exit(2);
  }

  const file = path.join(MESSAGES, `${lang}.json`);
  const dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

  const needPlain = catalogue.filter(
    (k) => !plurals.has(k) && (force || dict[k] === undefined),
  );
  const needPlural = catalogue.filter(
    (k) => plurals.has(k) && (force || typeof dict[k] !== 'object'),
  );

  console.log(`\n${lang}: бракує ${needPlain.length} фраз і ${needPlural.length} з формами множини`);
  if (dry) continue;
  if (!needPlain.length && !needPlural.length) continue;

  const plain = await translatePlain(needPlain, lang);
  for (const [k, v] of plain) dict[k] = v;

  for (let i = 0; i < needPlural.length; i += 15) {
    const forms = await translatePlurals(needPlural.slice(i, i + 15), lang);
    for (const [k, v] of forms) dict[k] = v;
  }

  // Catalogue order, so the diff reads like the product and a re-run is a no-op.
  const ordered = {};
  for (const k of catalogue) if (k in dict) ordered[k] = dict[k];
  for (const k of Object.keys(dict)) if (!(k in ordered)) ordered[k] = dict[k];
  fs.writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);

  const done = catalogue.filter((k) => k in ordered).length;
  console.log(`${lang}: ${done} із ${catalogue.length} — записано в ${file}`);
  console.log('Прочитайте диф. Це машинний переклад, і він буває впевнено неправильним.');
}
