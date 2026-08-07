/**
 * Create a customer.
 *
 *   node scripts/provision-org.mjs --name "Hotel Kyiv" --slug hotel-kyiv \
 *        --email owner@hotel-kyiv.ua [--password '…'] [--city Kyiv] \
 *        [--country UA] [--currency UAH] [--language uk] [--enable widget,teya]
 *
 * --language is the hotel's base language: uk en de cs pl nl fr. It sets the
 * interface for its staff and the source language of its content, so a German
 * customer is created with --language de, not corrected afterwards.
 *
 * Without --password one is generated and printed ONCE. It is never stored
 * anywhere but the password hash, so copy it before closing the terminal.
 *
 * This is the operator's tool, not a public signup: a PMS is sold, not
 * self-served, and an open provisioning endpoint is an open invitation. When
 * a signup form appears it calls the same provisionOrganization().
 */
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const name = arg('name');
const slug = arg('slug');
const email = arg('email');

if (!name || !slug || !email) {
  console.error('Потрібно: --name "Назва" --slug slug --email owner@example.com');
  console.error('Необовʼязково: --password --city --country --currency --timezone --language --property --enable');
  process.exit(2);
}

// A generated password is 24 random chars — long enough that the 12-char
// minimum is never the thing standing between a customer and a weak login.
const password = arg('password') || crypto.randomBytes(18).toString('base64url').slice(0, 24);
const generated = !arg('password');

const { provisionOrganization } = await import('../src/core/provisioning.ts');

let result;
try {
  result = await provisionOrganization({
    name,
    slug,
    ownerEmail: email,
    ownerPassword: password,
    ownerName: arg('owner-name'),
    propertyName: arg('property'),
    city: arg('city'),
    country: arg('country'),
    currency: arg('currency'),
    timezone: arg('timezone'),
    language: arg('language'),
    enable: (arg('enable') || '').split(',').map((s) => s.trim()).filter(Boolean),
  });
} catch (e) {
  console.error('✗', e.message);
  process.exit(1);
}

console.log('═'.repeat(70));
console.log(`Організацію створено: ${name}`);
console.log('═'.repeat(70));
console.log();
console.log(`  organization_id  ${result.organizationId}`);
console.log(`  property_id      ${result.propertyId}`);
console.log(`  owner            ${email}`);
console.log(`  базова мова      ${result.language}`);
if (generated) {
  console.log(`  пароль           ${password}`);
  console.log();
  console.log('  Пароль показано ОДИН раз — збережіть його зараз.');
}
console.log();
console.log('  Базова мова діє на весь готель: інтерфейс персоналу, мова, якою');
console.log('  вводиться контент, і джерело перекладів для гостей. Окрема людина');
console.log('  може обрати свою — Налаштування → Користувачі та ролі.');
console.log();
console.log('  Усі інтеграції вимкнені. Вмикати — Налаштування → Модулі та інтеграції,');
console.log('  коли для них справді є ключі.');
