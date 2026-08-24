/**
 * The supplier's own account — the one that can step into any customer.
 *
 *   node scripts/platform-user.mjs --email you@company.com [--password '…']
 *   node scripts/platform-user.mjs --list
 *   node scripts/platform-user.mjs --email you@company.com --deactivate
 *
 * On the server, inside the container of the environment:
 *
 *   docker exec -it alisio-beta-app node scripts/platform-user.mjs --email …
 *   docker exec -it alisio-prod-app node scripts/platform-user.mjs --email …
 *
 * Creating one when it does not exist, resetting the password when it does.
 * Without --password one is generated and printed ONCE.
 *
 * Shell only, and deliberately so. This account opens every hotel in the
 * database, including their guests' passport details; the thing that mints it
 * must not be reachable over HTTP at all, no matter who is logged in. There is
 * no signup, no invite, no "forgot password" — a person with the server has it,
 * and nobody else does.
 *
 * Each environment is a separate database, so a platform account on beta is not
 * one on prod. Run it twice if you want both.
 */
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const bcrypt = (await import('bcryptjs')).default;
const { getSql } = await import('../src/core/db/async.ts');
const sql = getSql();

// ── --list ────────────────────────────────────────────────────────────────
if (has('list')) {
  const rows = await sql.rows('SELECT email, full_name, is_active, last_login, created_at FROM platform_users ORDER BY email');
  if (rows.length === 0) {
    console.log('\nПлатформних акаунтів немає.');
  } else {
    console.log('\nПлатформні акаунти:');
    for (const r of rows) {
      console.log(`  ${r.email}  ·  ${r.is_active ? 'активний' : 'ВИМКНЕНИЙ'}  ·  останній вхід: ${r.last_login || '—'}`);
    }
  }
  process.exit(0);
}

const email = arg('email');
if (!email) {
  console.error('Потрібно: --email you@company.com');
  console.error('Необовʼязково: --password "…"  --name "Імʼя"  --deactivate  --activate  --list');
  process.exit(2);
}

const existing = await sql.row(
  'SELECT id, email, full_name, is_active FROM platform_users WHERE lower(email) = lower(?)',
  [email],
);

// ── --deactivate / --activate ─────────────────────────────────────────────
if (has('deactivate') || has('activate')) {
  if (!existing) {
    console.error(`\nНемає платформного акаунта ${email}.`);
    process.exit(1);
  }
  const active = has('activate');
  await sql.run(
    'UPDATE platform_users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [active ? true : false, existing.id],
  );
  // Switching an account off must also throw out the sessions it already has,
  // otherwise "deactivated" means "cannot log in again" rather than "is out".
  if (!active) {
    await sql.run('DELETE FROM platform_sessions WHERE platform_user_id = ?', [existing.id]);
  }
  console.log(`\n✓ ${email} — ${active ? 'увімкнено' : 'вимкнено, відкриті сесії закрито'}.`);
  process.exit(0);
}

// ── create / reset password ───────────────────────────────────────────────
const password = arg('password') || crypto.randomBytes(18).toString('base64url').slice(0, 24);
const generated = !arg('password');

if (arg('password') && arg('password').length < 12) {
  console.error('Пароль закороткий: мінімум 12 символів.');
  process.exit(2);
}

const hash = bcrypt.hashSync(password, 10);

if (existing) {
  await sql.run(
    'UPDATE platform_users SET password_hash = ?, is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [hash, existing.id],
  );
  console.log(`\n✓ Пароль платформного акаунта ${existing.email} оновлено.`);
} else {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  await sql.run(
    'INSERT INTO platform_users (id, email, full_name, password_hash, is_active) VALUES (?, ?, ?, ?, TRUE)',
    [id, email, arg('name') || null, hash],
  );
  console.log(`\n✓ Платформний акаунт ${email} створено.`);
}

// Read it back. An UPDATE the row-level policy filtered away returns success
// and changes nothing — the failure mode worth ruling out on an auth table.
const after = await sql.row('SELECT password_hash FROM platform_users WHERE lower(email) = lower(?)', [email]);
if (!after || after.password_hash !== hash) {
  console.error('\nПароль НЕ записався — рядок не змінився.');
  process.exit(1);
}

if (generated) {
  console.log(`\n  пароль: ${password}`);
  console.log('\n  Показано один раз. Скопіюйте зараз.');
}
console.log('\n  Вхід: /app/platform/login — сторінка навмисно не звʼязана з екраном входу готелю.');
console.log('  Кожен вхід у готель пишеться в його журнал (platform_audit).');
process.exit(0);
