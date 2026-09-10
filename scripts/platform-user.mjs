/**
 * The supplier's own account — the one that can step into any customer.
 *
 *   node scripts/platform-user.mjs --email you@company.com --supplier [--password '…']
 *   node scripts/platform-user.mjs --list
 *   node scripts/platform-user.mjs --email you@company.com --deactivate
 *
 * Готельєр із кількома рахунками (П21) — той самий акаунт, але РОДУ
 * `hotelier`, і він входить лише туди, де має членство:
 *
 *   node scripts/platform-user.mjs --email owner@hotel.com            # створити (рід за замовчуванням)
 *   node scripts/platform-user.mjs --email owner@hotel.com --grant <org-slug-або-id>
 *   node scripts/platform-user.mjs --email owner@hotel.com --revoke <org-slug-або-id>
 *   node scripts/platform-user.mjs --email owner@hotel.com --memberships
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
 *
 * ── Рід пишеться руками, і слабший — за замовчуванням ─────────────────────
 *
 * `--supplier` дає акаунт, який входить у БУДЬ-ЯКИЙ рахунок; без прапорця
 * створюється готельєр, який без членства не входить нікуди. Так тому, що
 * забутий прапорець мусить давати нуль доступу, а не всі готелі на сервері
 * (інваріанти 8 і 13).
 *
 * ── Один пароль, а не два ─────────────────────────────────────────────────
 *
 * `--grant` за замовчуванням ЗНІМАЄ локальний пароль того рядка `app_users`:
 * інакше в людини лишилось би два входи з двома паролями в той самий готель —
 * рівно те, від чого П21 і йде. `--keep-local-password` лишає обидва свідомо, і
 * скрипт про це каже вголос.
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
  const rows = await sql.rows('SELECT email, full_name, is_active, last_login, created_at, kind FROM platform_users ORDER BY email');
  if (rows.length === 0) {
    console.log('\nПлатформних акаунтів немає.');
  } else {
    console.log('\nПлатформні акаунти:');
    for (const r of rows) {
      const kind = r.kind === 'supplier' ? 'ПОСТАЧАЛЬНИК (усі рахунки)' : 'готельєр (лише свої)';
      console.log(`  ${r.email}  ·  ${kind}  ·  ${r.is_active ? 'активний' : 'ВИМКНЕНИЙ'}  ·  останній вхід: ${r.last_login || '—'}`);
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
  'SELECT id, email, full_name, is_active, kind FROM platform_users WHERE lower(email) = lower(?)',
  [email],
);

// ── --memberships / --grant / --revoke ────────────────────────────────────
//
// Перелік «у які рахунки ця людина може входити». Постачальникові він не
// потрібен і не питається — його рід і є переліком.
if (has('memberships') || arg('grant') || arg('revoke')) {
  if (!existing) {
    console.error(`\nНемає платформного акаунта ${email}. Спершу створіть його.`);
    process.exit(1);
  }
  if (existing.kind === 'supplier') {
    console.error(`\n${email} — ПОСТАЧАЛЬНИК: він входить у будь-який рахунок, і перелік йому нічого не додає.`);
    console.error('Членство заводиться готельєрам. Якщо це помилка роду — заведіть окремий акаунт.');
    process.exit(2);
  }

  const findOrg = async (key) => await sql.row(
    'SELECT id, name, slug FROM organizations WHERE id = ? OR lower(slug) = lower(?)', [key, key]);

  if (arg('grant')) {
    const org = await findOrg(arg('grant'));
    if (!org) { console.error(`\nРахунку «${arg('grant')}» немає.`); process.exit(1); }

    // Ким людина є в тому рахунку — без відповіді членства не існує.
    const appUser = await sql.row(
      'SELECT id, full_name, role, password_hash FROM app_users WHERE organization_id = ? AND lower(email) = lower(?)',
      [org.id, email]);
    if (!appUser) {
      console.error(`\nУ рахунку «${org.name}» немає користувача з поштою ${email}.`);
      console.error('Членство мусить назвати, КИМ людина є в тому рахунку: заведіть їй користувача');
      console.error('на екрані «Користувачі» цього готелю, потім повторіть.');
      process.exit(1);
    }

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    await sql.run(
      `INSERT INTO platform_memberships (id, platform_user_id, organization_id, app_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (platform_user_id, organization_id) DO UPDATE SET app_user_id = excluded.app_user_id`,
      [id, existing.id, org.id, appUser.id]);
    console.log(`\n✓ ${email} → «${org.name}» як ${appUser.full_name} (${appUser.role}).`);

    if (appUser.password_hash && !has('keep-local-password')) {
      await sql.run('UPDATE app_users SET password_hash = NULL WHERE id = ?', [appUser.id]);
      console.log('  Локальний пароль цього рядка знято: вхід тепер один — платформний.');
      console.log('  (--keep-local-password лишає обидва, якщо це навмисно.)');
    } else if (appUser.password_hash) {
      console.log('  УВАГА: локальний пароль лишено — у людини два входи і два паролі в цей готель.');
    }
    process.exit(0);
  }

  if (arg('revoke')) {
    const org = await findOrg(arg('revoke'));
    if (!org) { console.error(`\nРахунку «${arg('revoke')}» немає.`); process.exit(1); }
    const res = await sql.run(
      'DELETE FROM platform_memberships WHERE platform_user_id = ? AND organization_id = ?',
      [existing.id, org.id]);
    // Членство знято — сесія, яка стоїть усередині, мусить вийти. Інакше
    // «знято» означало б «не увійде наступного разу», а не «вже не всередині».
    await sql.run(
      'UPDATE platform_sessions SET acting_organization_id = NULL WHERE platform_user_id = ? AND acting_organization_id = ?',
      [existing.id, org.id]);
    console.log(res.changes ? `\n✓ ${email} більше не входить у «${org.name}»; відкриті сесії виведено.`
                            : `\n${email} і не мав членства в «${org.name}».`);
    process.exit(0);
  }

  const rows = await sql.rows(
    `SELECT o.name, o.slug, u.full_name, u.role
       FROM platform_memberships m
       JOIN organizations o ON o.id = m.organization_id
       JOIN app_users u ON u.id = m.app_user_id
      WHERE m.platform_user_id = ? ORDER BY o.name`, [existing.id]);
  console.log(rows.length ? `\nРахунки ${email}:` : `\n${email} не має жодного рахунку — увійти нікуди.`);
  for (const r of rows) console.log(`  ${r.name} (${r.slug})  ·  ${r.full_name} — ${r.role}`);
  process.exit(0);
}

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
  const kind = has('supplier') ? 'supplier' : 'hotelier';
  await sql.run(
    'INSERT INTO platform_users (id, email, full_name, password_hash, is_active, kind) VALUES (?, ?, ?, ?, TRUE, ?)',
    [id, email, arg('name') || null, hash, kind],
  );
  console.log(`\n✓ Платформний акаунт ${email} створено — рід: ${kind === 'supplier' ? 'ПОСТАЧАЛЬНИК (усі рахунки)' : 'готельєр'}.`);
  if (kind === 'hotelier') {
    console.log('  Він поки не входить нікуди: заведіть членство --grant <рахунок>.');
  }
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
