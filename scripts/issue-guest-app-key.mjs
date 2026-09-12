/**
 * Видати обʼєкту ключ гостьового застосунку — адресу, куди веде QR на склі.
 *
 *   node scripts/issue-guest-app-key.mjs --list
 *   node scripts/issue-guest-app-key.mjs --property <id|slug>
 *   node scripts/issue-guest-app-key.mjs --property <id|slug> --rotate
 *
 * ── Навіщо скрипт, а не екран ───────────────────────────────────────────
 *
 * Екран буде, і він «звичайна акуратність» за інваріантом 29 — форма
 * налаштувань обʼєкта. Але ключ потрібен РАНІШЕ за форму: без нього сторінка
 * не існує за жодною адресою, тобто перевірити крок «немає бронювання» на
 * беті сьогодні неможливо взагалі.
 *
 * ── Чому видача окремою дією, а не при заведенні готелю ─────────────────
 *
 * Ключ — це публічна адреса, за якою будь-хто з інтернету бачить назву
 * готелю і його вільні номери. Видати його КОЖНОМУ готелю при заведенні
 * означало б відчинити цю сторінку тим, хто про неї не просив. Тому: готель
 * попросив — готель дістав.
 *
 * `--rotate` замінює наявний ключ. Це не «оновити», а ВІДКЛЮЧИТИ старі
 * наліпки: усі надруковані QR перестають вести куди-небудь тієї ж секунди.
 * Тому воно окремим прапорцем, а не мовчазним переписуванням.
 */
import '../scripts/lib/module-aliases.mjs';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

await import('../src/lib/db.ts');
const { getSql } = await import('../src/core/db/async.ts');
const { runWithOrganization } = await import('../src/core/auth/tenant-context.ts');
const { generateGuestAppKey } = await import('../src/apps/guest-app/domain/key.ts');

const sql = getSql();
const base = process.env.APP_BASE_URL || 'https://beta.alisio.rozum.one';

// Читання йде повз орендаря навмисно: це інструмент оператора, який дивиться
// на сервер згори, а не застосунок. На Postgres так ходить лише власник схеми
// з `row_security = off` — у скриптах оператора це вже усталено
// (deploy/list-tenants.sh).
const properties = await sql.rows(
  `SELECT p.id, p.slug, p.name, p.organization_id, p.guest_app_key, o.name AS org_name
     FROM properties p JOIN organizations o ON o.id = p.organization_id
    ORDER BY o.name, p.name`);

if (has('list') || !arg('property')) {
  console.log('Обʼєкти та їхні ключі гостьового застосунку:\n');
  for (const p of properties) {
    const where = p.guest_app_key ? `${base}/stay/${p.guest_app_key}` : '— ключа немає';
    console.log(`  ${p.org_name} / ${p.name}`);
    console.log(`    slug: ${p.slug}    id: ${p.id}`);
    console.log(`    ${where}\n`);
  }
  if (!arg('property')) {
    console.log('Видати ключ:  node scripts/issue-guest-app-key.mjs --property <id|slug>');
  }
  process.exit(0);
}

const wanted = String(arg('property'));
const target = properties.find((p) => p.id === wanted || p.slug === wanted);
// Не знайшли — відмова, а не «візьму перший» (інваріант 13). Перший-ліпший
// обʼєкт тут означав би наліпку на дверях чужого готелю.
if (!target) {
  console.error(`Обʼєкта «${wanted}» немає. Подивитись усі: --list`);
  process.exit(1);
}

if (target.guest_app_key && !has('rotate')) {
  console.log(`У обʼєкта «${target.name}» ключ уже є:`);
  console.log(`  ${base}/stay/${target.guest_app_key}`);
  console.log('\nЗамінити (і зробити всі надруковані QR непрацюючими): --rotate');
  process.exit(0);
}

const key = generateGuestAppKey();
await runWithOrganization(String(target.organization_id), () => sql.run(
  'UPDATE properties SET guest_app_key = ? WHERE id = ? AND organization_id = ?',
  [key, target.id, target.organization_id]));

// Читаємо НАЗАД, окремим запитом: `UPDATE` без помилки не доводить, що рядок
// змінився — політика могла відхилити його мовчки (рід И4).
const back = await runWithOrganization(String(target.organization_id), () => sql.row(
  'SELECT guest_app_key FROM properties WHERE id = ? AND organization_id = ?',
  [target.id, target.organization_id]));
if (!back || back.guest_app_key !== key) {
  console.error('Ключ не записався — рядок лишився без змін. Перевірте, під якою роллю ви ходите в базу.');
  process.exit(1);
}

console.log(`${target.org_name} / ${target.name}${has('rotate') ? ' — ключ замінено' : ''}`);
console.log(`  ${base}/stay/${key}`);
