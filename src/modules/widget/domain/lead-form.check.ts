/**
 * A guest's contact form reaches the hotel whole.
 *
 *   node src/modules/widget/domain/lead-form.check.ts
 *
 * `collector.js` posts whatever the hotel's own website calls its fields, and
 * the table has four columns. Everything below is about the ways that mapping
 * can quietly lose something: a Czech label nobody thought of, a form that
 * splits the name in two, a question we have no column for.
 *
 * The one thing that must never happen is a 200 with content missing. A guest
 * who wrote «приїдемо з собакою» and got «дякуємо» has been answered by a
 * system that threw the sentence away.
 */
import assert from 'node:assert';
import { foldFormIntoLead, isEmptyLead, isTrapped, HONEYPOT } from './lead-form.ts';

// ── The plain case ───────────────────────────────────────────────────
assert.deepStrictEqual(
  foldFormIntoLead({
    siteId: 'site_1', sourceUrl: 'https://example.invalid/kontakt', [HONEYPOT]: '',
    name: 'Jan Novák', email: ' JAN@example.invalid ', phone: '+420 723 000 000',
    message: 'Dobrý den, mám dotaz.',
  }),
  {
    full_name: 'Jan Novák', email: 'JAN@example.invalid',
    phone: '+420 723 000 000', message: 'Dobrý den, mám dotaz.',
  },
  'the envelope keys the collector adds are not guest content and must not become a row',
);
console.log('  ok  звичайна форма лягає в чотири колонки');

// ── Somebody else's field names ──────────────────────────────────────
const czech = foldFormIntoLead({ jmeno: 'Petra', 'e-mail': 'petra@example.invalid', zprava: 'Máte volno v srpnu?' });
assert.strictEqual(czech.full_name, 'Petra');
assert.strictEqual(czech.email, 'petra@example.invalid', 'e-mail with a hyphen is the same field');
assert.strictEqual(czech.message, 'Máte volno v srpnu?');

const german = foldFormIntoLead({ Vorname: 'Anna', Nachname: 'Weber', Telefon: '030 1234', Nachricht: 'Frage zum Frühstück' });
assert.strictEqual(german.full_name, 'Anna Weber', 'a form that splits the name in two is common');
assert.strictEqual(german.phone, '030 1234');
assert.strictEqual(german.message, 'Frage zum Frühstück');

assert.strictEqual(foldFormIntoLead({ 'Your Email': 'a@example.invalid' }).email, 'a@example.invalid',
  'spaces and capitals in a label are not a different field');
console.log('  ok  чужі назви полів (cs/de/en) впізнаються');

// ── Nothing the guest typed is dropped ───────────────────────────────
const extras = foldFormIntoLead({
  email: 'k@example.invalid',
  message: 'Dobrý den.',
  pocet_hostu: '4',
  dog: 'ano',
});
assert.ok(extras.message?.includes('Dobrý den.'), 'the message itself stays first');
assert.ok(extras.message?.includes('pocet_hostu: 4'),
  'a field we have no column for must survive as text — the table has no raw_data any more');
assert.ok(extras.message?.includes('dog: ano'));

const twice = foldFormIntoLead({ email: 'k@example.invalid', message: 'first', note: 'second' });
assert.ok(twice.message?.includes('first') && twice.message?.includes('second'),
  'two message-ish fields must not overwrite each other');
console.log('  ok  поле без колонки не зникає, а дописується в текст');

// ── The honeypot ─────────────────────────────────────────────────────
assert.strictEqual(isTrapped({ [HONEYPOT]: '' }), false, 'empty is a human — collector.js sends it empty');
assert.strictEqual(isTrapped({}), false, 'absent is a human — a hand-written SPA call omits it');
assert.strictEqual(isTrapped({ [HONEYPOT]: 'http://spam' }), true);
assert.strictEqual(
  foldFormIntoLead({ email: 'k@example.invalid', [HONEYPOT]: 'x' }).message, null,
  'the trap value must never end up in the message a receptionist reads');
console.log('  ok  пастка для ботів не тече в текст ліда');

// ── A row worth nobody's morning ─────────────────────────────────────
assert.strictEqual(isEmptyLead(foldFormIntoLead({ name: 'Someone' })), true,
  'a name with no contact and no message cannot be answered');
assert.strictEqual(isEmptyLead(foldFormIntoLead({ phone: '+420 1' })), false);
assert.strictEqual(isEmptyLead(foldFormIntoLead({ pocet_hostu: '4' })), false,
  'an unmatched field still became a message, so there IS something to read');
assert.strictEqual(isEmptyLead(foldFormIntoLead({ name: '   ', email: '  ' })), true,
  'whitespace is not an enquiry');
console.log('  ok  порожня форма не створює рядок');

// ── Bounds ───────────────────────────────────────────────────────────
const long = foldFormIntoLead({ email: 'k@example.invalid', message: 'x'.repeat(9000) });
assert.strictEqual(long.message?.length, 5000, 'a pasted novel is truncated, not refused');
assert.strictEqual(foldFormIntoLead({ email: 'e'.repeat(400) }).email?.length, 254);
console.log('  ok  довжини обрізаються, а не валять запит');

// ── Non-strings ──────────────────────────────────────────────────────
assert.deepStrictEqual(
  foldFormIntoLead({ email: 42, phone: null, message: { a: 1 }, name: ['x'] } as never),
  { full_name: null, email: null, phone: null, message: null },
  'a hand-rolled Alisio.sendForm() call can send anything; nothing here may throw',
);
console.log('  ok  не-рядки не валять розбір');

console.log('lead-form: ok');
