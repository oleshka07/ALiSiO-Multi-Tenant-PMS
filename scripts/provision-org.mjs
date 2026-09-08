/**
 * Create a customer.
 *
 *   node scripts/provision-org.mjs --name "Hotel Kyiv" --slug hotel-kyiv \
 *        --email owner@hotel-kyiv.ua --currency UAH [--password '…'] \
 *        [--city Kyiv] [--country UA] [--language uk] [--enable widget]
 *
 * --currency is the hotel's base currency, and it is required for the same
 * reason --language is checked: it decides what every sum in the system means.
 * It used to default to CZK, so a hotel created without it silently became
 * Czech — prices, invoices, the widget and guest emails all in koruna, with no
 * error anywhere.
 *
 * --timezone or --country: одне з двох обовʼязкове, і мовчазного дефолту
 * більше немає. Пояс вирішує, де проходить межа доби — приїзди, виїзди,
 * нічний архів неявок і дати, якими торгує канал; `'Europe/Prague'` за
 * замовчуванням помилявся на годину для кожного українського готелю. Країна з
 * ОДНИМ поясом (UA, CZ, PL, DE, …) дає його сама, і скрипт друкує висновок на
 * підтвердження; країна з кількома (US, ES, PT, FR, RU) вимагає --timezone.
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
// Валюта обовʼязкова: це основа, від якої рахує вся система. Раніше її
// відсутність тихо давала крони.
const currency = arg('currency');

if (!name || !slug || !email || !currency) {
  console.error('Потрібно: --name "Назва" --slug slug --email owner@example.com --currency CZK');
  console.error('І одне з двох: --timezone Europe/Kyiv  або  --country UA (пояс виведеться з країни)');
  console.error('Необовʼязково: --password --city --language --property --enable');
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
    currency,
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
console.log(`  часовий пояс     ${result.timezone}${result.timezoneFrom === 'country' ? '  ← виведено з країни' : ''}`);
if (generated) {
  console.log(`  пароль           ${password}`);
  console.log();
  console.log('  Пароль показано ОДИН раз — збережіть його зараз.');
}
console.log();
if (result.timezoneFrom === 'country') {
  console.log('  Часовий пояс НЕ називали — його виведено з країни. Він вирішує, де');
  console.log('  проходить межа доби: приїзди, виїзди і дати, якими торгує канал.');
  console.log('  Перевірте його з готелем — Налаштування → Загальні.');
  console.log();
}
console.log('  Базова мова діє на весь готель: інтерфейс персоналу, мова, якою');
console.log('  вводиться контент, і джерело перекладів для гостей. Окрема людина');
console.log('  може обрати свою — Налаштування → Користувачі та ролі.');
console.log();
console.log('  Усі інтеграції вимкнені. Вмикати — Налаштування → Модулі та інтеграції,');
console.log('  коли для них справді є ключі.');
