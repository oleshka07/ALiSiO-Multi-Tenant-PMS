/**
 * Які імена полів вважаємо чутливими — одне визначення на два інструменти
 * дослідження:
 *
 *   site-crawl.mjs   позначає поле у знятому описі екрана
 *   har-digest.mjs   ховає значення, лишаючи тип
 *
 * Розділення на два списки — не косметика, воно виправляє реальну помилку.
 * Спершу тут стояв один список підрядків, і `tel` збігався всередині
 * `hotel_name`, `lat` — усередині `template`, `pan` — усередині `panel`,
 * `ico` — усередині `icon`, `dic` — усередині `predicate`. Тобто перевірка,
 * написана заради приховування персональних даних, вирізала б рівно ті поля,
 * заради яких дослідження й ведеться: назву готелю, шаблони, іконки.
 *
 * Тож короткі токени звіряються цілим словом. Межа — саме `(?<![a-z])`, а не
 * `\b`: у регулярних виразах JS підкреслення є частиною слова, тому `\bpan\b`
 * не побачив би `pan_id`. Тут же `pan_id` і `id_pan` збігаються, а `panel`,
 * `expand` і `japan` — ні.
 */

/** Довгі й однозначні: збіг будь-де в імені. */
const SUBSTRING = [
  'token',
  'password',
  'passwd',
  'secret',
  'api[-_]?key',
  'authorization',
  'session',
  'cookie',
  'signature',
  'iban',
  'email',
  'phone',
  'telephone',
  'mobile',
  'passport',
  'birth',
  'address',
  'street',
  'postal',
  'longitude',
  'latitude',
  'firstname',
  'lastname',
  'surname',
  'fullname',
  'guest[-_]?name',
  'vat[-_]?number',
];

/** Короткі: лише цілим словом, інакше ловлять пів словника. */
const WHOLE_WORD = ['tel', 'pan', 'ico', 'dic', 'dob', 'ssn', 'cvv', 'bic', 'lat', 'lng'];

/**
 * Межа лише зліва: продовження слова тут доречне, початок — ні.
 * `card` має зловити `cardholder` і `credit_card`, але не `discard_reason`;
 * `zip` — `zipcode`, але не `unzip`. Межа з обох боків зламала б перші.
 */
const LEFT_BOUNDED = ['card', 'zip'];

/** Вміст, а не ім'я: поле з такою назвою майже завжди тримає вільний текст. */
const FREE_TEXT = ['note', 'comment', 'message'];

export const SENSITIVE_SOURCE =
  `(${[...SUBSTRING, ...FREE_TEXT].join('|')}` +
  `|(?<![a-z])(?:${WHOLE_WORD.join('|')})(?![a-z])` +
  `|(?<![a-z])(?:${LEFT_BOUNDED.join('|')}))`;

export const SENSITIVE = new RegExp(SENSITIVE_SOURCE, 'i');
