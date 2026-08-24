/**
 * Set a person's password when nobody can log in to set it from the screen.
 *
 *   node scripts/reset-password.mjs --email owner@hotel.de [--password '…']
 *   node scripts/reset-password.mjs --email owner@hotel.de --activate
 *
 * On the server, inside the container of the environment:
 *
 *   docker exec -it alisio-beta-app node scripts/reset-password.mjs --email …
 *   docker exec -it alisio-prod-app node scripts/reset-password.mjs --email …
 *
 * Without --password one is generated and printed ONCE — nothing but the hash
 * is stored, so copy it before closing the terminal.
 *
 * Why this exists: the only way to change a password was the users screen,
 * which needs a session, which needs a password. An owner who loses theirs has
 * no way back in, and «reset it in the database» is an invitation to write a
 * bcrypt hash by hand at two in the morning. It also prints the account's real
 * state — active, has a hash, which organization — because «the password does
 * not work» and «the account is deactivated» look identical from the login
 * screen and are fixed differently.
 *
 * This is deliberately a shell tool and not an endpoint: something that sets
 * any password without proving who you are must not be reachable over HTTP.
 */
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const email = arg('email');
if (!email) {
  console.error('Потрібно: --email owner@example.com');
  console.error('Необовʼязково: --password "…"  --activate  --show');
  process.exit(2);
}

// Long enough that the 12-character minimum is never the thing between a
// customer and a weak login.
const password = arg('password') || crypto.randomBytes(18).toString('base64url').slice(0, 24);
const generated = !arg('password');

if (arg('password') && arg('password').length < 12) {
  console.error('Пароль закороткий: мінімум 12 символів.');
  process.exit(2);
}

const bcrypt = (await import('bcryptjs')).default;
const { getSql } = await import('../src/core/db/async.ts');
const { runWithOrganization } = await import('../src/core/auth/tenant-context.ts');

const sql = getSql();

// app_users opens its READ side with no tenant set — that is what lets login
// find the row before it knows the organization. The write below does not, so
// it runs inside the organization this lookup reveals.
const users = await sql.rows(
  'SELECT id, organization_id, email, full_name, role, is_active, (password_hash IS NOT NULL) AS has_hash FROM app_users WHERE lower(email) = lower(?)',
  [email],
);

if (users.length === 0) {
  console.error(`\nНемає користувача з email ${email}.`);
  const all = await sql.rows('SELECT email, role, is_active FROM app_users ORDER BY email');
  if (all.length > 0) {
    console.error('\nЩо є в цій базі:');
    for (const u of all) {
      console.error(`  ${u.email}  ·  ${u.role}  ·  ${u.is_active ? 'активний' : 'ДЕАКТИВОВАНИЙ'}`);
    }
  } else {
    console.error('\nУ базі взагалі немає користувачів — це не те середовище, або готель не заведений.');
  }
  process.exit(1);
}

if (users.length > 1) {
  console.error(`\nЦей email належить кільком організаціям (${users.length}). Скрипт не вгадує, кому саме:`);
  for (const u of users) console.error(`  ${u.id}  org=${u.organization_id}  ${u.role}`);
  process.exit(1);
}

const user = users[0];

console.log('\nЗнайдено:');
console.log(`  email            ${user.email}`);
console.log(`  імʼя             ${user.full_name || '—'}`);
console.log(`  роль             ${user.role}`);
console.log(`  організація      ${user.organization_id}`);
console.log(`  активний         ${user.is_active ? 'так' : 'НІ — вхід відмовить навіть із правильним паролем'}`);
console.log(`  пароль заданий   ${user.has_hash ? 'так' : 'ні'}`);

if (has('show')) {
  console.log('\n--show: нічого не змінено.');
  process.exit(0);
}

const hash = bcrypt.hashSync(password, 10);

await runWithOrganization(user.organization_id, async () => {
  await sql.run(
    'UPDATE app_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
    [hash, user.id, user.organization_id],
  );
  if (has('activate') && !user.is_active) {
    await sql.run(
      'UPDATE app_users SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
      [user.id, user.organization_id],
    );
  }
});

// Read it back through the same seam. An UPDATE that the row-level policy
// silently filtered returns success and changes nothing — the failure mode
// this whole tool exists to end.
const after = await sql.row(
  'SELECT password_hash, is_active FROM app_users WHERE id = ?',
  [user.id],
);
if (!after || after.password_hash !== hash) {
  console.error('\nПароль НЕ записався. Рядок не змінився — найімовірніше політика доступу відфільтрувала UPDATE.');
  process.exit(1);
}

console.log('\n✓ Пароль оновлено і перечитано з бази.');
if (has('activate') && !user.is_active) {
  console.log(`✓ Обліковий запис активовано (було: деактивований).`);
} else if (!user.is_active) {
  console.log('\n⚠ Обліковий запис ДЕАКТИВОВАНИЙ — вхід відмовить. Додайте --activate.');
}
if (generated) {
  console.log(`\n  пароль: ${password}`);
  console.log('\n  Показано один раз. Скопіюйте зараз.');
}

// Sessions are not touched on purpose: changing a password should not throw
// out the colleague who is mid-shift in another browser. Log everyone out by
// deleting their sessions rows if that is what you actually want.
process.exit(0);
