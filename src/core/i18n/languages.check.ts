/**
 * Language resolution.
 *
 *   node src/core/i18n/languages.check.ts
 *
 * The cases below are the ones a second hotel actually hits: a German customer
 * whose staff must not read Ukrainian, a person who wants their own language
 * without detaching from the hotel, and content that must not be translated
 * "from Ukrainian" when nobody wrote any Ukrainian.
 */
import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  fromAcceptLanguage,
  isLanguage,
  parseLanguage,
  targetLanguages,
} from './languages.ts';

// ─── the registry itself ─────────────────────────────────────────────────────
assert.ok(isLanguage('de'), 'German is the whole point of this work');
assert.ok(!isLanguage('klingon'));
assert.ok(!isLanguage(''));
assert.ok(LANGUAGE_CODES.includes(DEFAULT_LANGUAGE), 'the default has to be a real language');
console.log('  ok  the registry knows what a language is');

// A column, a form field and a query string all arrive as untrusted strings.
assert.strictEqual(parseLanguage('DE'), 'de', 'case is not a different language');
assert.strictEqual(parseLanguage('de-AT'), 'de', 'Austrian German is still German');
assert.strictEqual(parseLanguage('de_DE'), 'de');
assert.strictEqual(parseLanguage(null), DEFAULT_LANGUAGE);
assert.strictEqual(parseLanguage('nonsense', 'cs'), 'cs', 'garbage falls back, it does not throw');
console.log('  ok  an untrusted code is narrowed or falls back');

// ─── the content source ──────────────────────────────────────────────────────
// This is the one that silently corrupts data: a German hotel's text must not
// be handed to a translator as though it were Ukrainian, and must not be
// "translated" into the language it is already in.
const german = targetLanguages('de');
assert.ok(!german.includes('de'), 'a hotel does not translate its own language to itself');
assert.ok(german.includes('uk') && german.includes('en'));
assert.strictEqual(german.length, LANGUAGE_CODES.length - 1);
console.log('  ok  content is translated into every language except its own');

// ─── a guest with no account ─────────────────────────────────────────────────
assert.strictEqual(fromAcceptLanguage('de-DE,de;q=0.9,en;q=0.8', 'cs'), 'de');
assert.strictEqual(
  fromAcceptLanguage('en;q=0.3,de;q=0.9', 'cs'),
  'de',
  'q-values are ranked, not ignored',
);
assert.strictEqual(fromAcceptLanguage('zz', 'cs'), 'cs', 'an unknown tag leaves the hotel default');
assert.strictEqual(fromAcceptLanguage(null, 'cs'), 'cs');
assert.strictEqual(fromAcceptLanguage('de;q=0', 'cs'), 'cs', 'q=0 means "not this one"');
console.log('  ok  a guest browser is read, and never overrides with nonsense');

// ─── who gets the last word, against a real database ─────────────────────────
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE organizations (id TEXT PRIMARY KEY, language TEXT NOT NULL DEFAULT 'uk', updated_at TEXT);
  CREATE TABLE app_users (id TEXT PRIMARY KEY, organization_id TEXT, language TEXT, updated_at TEXT);
  INSERT INTO organizations (id, language) VALUES ('hotel_de', 'de'), ('hotel_ua', 'uk');
  INSERT INTO app_users (id, organization_id, language) VALUES
    ('anna', 'hotel_de', NULL),
    ('petro', 'hotel_de', 'uk');
`);

// The resolvers sit on the async seam with the rest of core, and take an Sql
// so this can run them against the in-memory database above.
const { sqliteSql } = await import('../db/async.ts');
const { organizationLanguage, setOrganizationLanguage, setUserLanguage, userLanguage } =
  await import('./resolve.ts');
const sql = sqliteSql(db);

assert.strictEqual(await organizationLanguage('hotel_de', sql), 'de');
assert.strictEqual(await organizationLanguage('no_such_hotel', sql), DEFAULT_LANGUAGE);
console.log('  ok  a hotel has a base language, and a missing one does not throw');

assert.strictEqual(
  await userLanguage('anna', sql),
  'de',
  'no personal choice means the hotel decides',
);
assert.strictEqual(await userLanguage('petro', sql), 'uk', 'a personal choice wins over the hotel');
console.log('  ok  the person outranks the hotel, and silence means the hotel');

// The reason NULL is stored rather than the hotel's current code: staff who
// never chose have to move when the hotel does.
await setOrganizationLanguage('hotel_de', 'cs', sql);
assert.strictEqual(await userLanguage('anna', sql), 'cs', 'anna follows the hotel to Czech');
assert.strictEqual(await userLanguage('petro', sql), 'uk', 'petro chose, so he stays');
console.log('  ok  changing the hotel moves everyone who never chose');

await setUserLanguage('petro', null, sql);
assert.strictEqual(await userLanguage('petro', sql), 'cs', 'clearing a choice rejoins the hotel');
console.log('  ok  clearing a personal language rejoins the hotel');

// ─── the three audiences do not answer the same question ─────────────────────
// This is the invariant the whole file exists for: a receptionist switching to
// German changes what SHE reads. It must not reach a guest or a document.
db.exec(`
  CREATE TABLE properties (id TEXT PRIMARY KEY, organization_id TEXT, country TEXT);
  CREATE TABLE reservations (id TEXT PRIMARY KEY, organization_id TEXT, guest_id TEXT, booking_lang TEXT);
  CREATE TABLE guests (id TEXT PRIMARY KEY, language TEXT, country TEXT);

  -- A Czech-registered hotel whose staff are Ukrainian. This is ALiSiO.
  INSERT INTO properties (id, organization_id, country) VALUES ('prop_cz', 'hotel_ua', 'CZ');
  INSERT INTO properties (id, organization_id, country) VALUES ('prop_none', 'hotel_ua', NULL);

  INSERT INTO guests (id, language, country) VALUES
    ('said_so', 'fr', 'DE'),
    ('silent_de', NULL, 'DE'),
    ('silent_nowhere', NULL, NULL);

  INSERT INTO reservations (id, organization_id, guest_id, booking_lang) VALUES
    ('r_said', 'hotel_ua', 'said_so', 'en'),
    ('r_booked', 'hotel_ua', 'silent_de', 'cs'),
    ('r_country', 'hotel_ua', 'silent_de', NULL),
    ('r_nothing', 'hotel_ua', 'silent_nowhere', NULL);
`);

const { documentLanguage, reservationLanguage } = await import('./resolve.ts');

// The document follows the jurisdiction, not the people.
assert.strictEqual(
  await documentLanguage('prop_cz', sql),
  'cs',
  'a Czech invoice stays Czech however the staff read the screen',
);
assert.strictEqual(
  await documentLanguage('prop_none', sql),
  'uk',
  'no country is a data gap, not a jurisdiction, so it falls back to the hotel',
);
console.log('  ok  a document is issued in the jurisdiction, not in anyone\'s language');

// The guest is asked in the order of how much they actually told us.
assert.strictEqual(await reservationLanguage('r_said', sql), 'fr', 'an explicit choice wins');
assert.strictEqual(
  await reservationLanguage('r_booked', sql),
  'cs',
  'else the language they booked in',
);
assert.strictEqual(
  await reservationLanguage('r_country', sql),
  'de',
  'else where they are — a guess, but a recorded one',
);
assert.strictEqual(
  await reservationLanguage('r_nothing', sql),
  'uk',
  'else the hotel, which is at least a decision somebody made',
);
console.log('  ok  a guest is written to in the language they gave, in that order');

// And none of the three moves when an operator changes theirs.
await setUserLanguage('anna', 'de', sql);
assert.strictEqual(await documentLanguage('prop_cz', sql), 'cs');
assert.strictEqual(await reservationLanguage('r_booked', sql), 'cs');
console.log('  ok  an operator switching language moves neither guest nor document');

db.close();
console.log('languages: base language, personal override, guest, document');
