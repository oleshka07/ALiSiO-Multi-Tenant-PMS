/**
 * Заявник на броні — РІВНО ОДИН, і його можна змінити.
 *
 *   node src/modules/guests/data/primary-registration.check.ts
 *
 * ── Чому це не косметика ────────────────────────────────────────────────
 *
 * `is_primary` — не прикраса списку. `meldeschein.repo` і `signature.repo`
 * обидва сортують `ORDER BY gr.is_primary DESC` і беруть ПЕРШОГО: заявник —
 * це той, хто ПІДПИСУЄ Meldeschein за все перебування. Тобто рядок із
 * зіркою визначає, чиє прізвище стоїть на документі для влади.
 *
 * Доти зірку роздавала єдина умова в екрані — `isPrimary: registrations.length
 * === 0`, тобто «хто перший, той і заявник». Портьє, який узяв документи в
 * порядку, у якому їх дали, отримував заявником не ту людину — і виправити це
 * можна було, лише знявши й завівши наново ВСІХ. Документ при цьому виглядав
 * нормально.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. ТРОЄ на броні, не двоє: із двома «зняли з усіх і поставили одному»
 *    нерозрізненне з «поміняли місцями двох».
 * 2. Друга бронь того самого готелю, теж із заявником: писач, який чистить
 *    зірку по ГОТЕЛЮ замість по БРОНІ, лишався б зеленим з однією.
 * 3. Другий готель: чужа бронь і чужий рядок реєстрації — «немає».
 *
 * Числа різні навмисно: 3 рядки на першій броні, 2 на другій.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-primary-reg-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { setPrimaryRegistration } = await import('./registration.repo.ts');

const sql = getSql();
const ORG = '__pr__org';
const NEIGHBOUR = '__pr__neighbour';

/**
 * Прибирання ПЕРЕД засівом — на Postgres база спільна на весь `check:pg`
 * (див. `company-guests.check`). Броні знімаються в контексті орендаря:
 * без нього політика не бачить жодного рядка і прибирає нуль — мовчки.
 */
for (const org of [ORG, NEIGHBOUR]) {
  await runWithOrganization(org, async () => {
    await sql.run("DELETE FROM guest_registrations WHERE id LIKE '__pr__%'", []);
    await sql.run("DELETE FROM reservations WHERE id LIKE '__pr__%'", []);
    await sql.run("DELETE FROM guests WHERE id LIKE '__pr__%'", []);
    await sql.run("DELETE FROM properties WHERE id LIKE '__pr__%'", []);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
}

for (const org of [ORG, NEIGHBOUR]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, () => sql.run(
    'INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
    [`__pr__prop_${org}`, org, 'Дім', `__pr__prop_${org}`]));
}

const stay = (id: string, org: string, guestId: string) => runWithOrganization(org, () => sql.run(
  `INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out, nights, adults, status, currency)
   VALUES (?, ?, ?, ?, '2027-03-01', '2027-03-03', 2, 3, 'confirmed', 'EUR')`,
  [id, org, `__pr__prop_${org}`, guestId]));

const person = (id: string, org: string, last: string) => runWithOrganization(org, () => sql.run(
  'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  [id, org, 'Ім', last]));

const reg = (id: string, org: string, resId: string, guestId: string, primary: boolean) =>
  runWithOrganization(org, () => sql.run(
    `INSERT INTO guest_registrations (id, reservation_id, guest_id, is_primary, registered_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, resId, guestId, primary]));

for (const [id, last] of [['__pr__g1', 'Перший'], ['__pr__g2', 'Другий'], ['__pr__g3', 'Третій'],
  ['__pr__g4', 'Четвертий'], ['__pr__g5', 'Пʼятий']]) {
  await person(id, ORG, last);
}
await person('__pr__gn', NEIGHBOUR, 'Сусідів');

await stay('__pr__res1', ORG, '__pr__g1');
await stay('__pr__res2', ORG, '__pr__g4');
await stay('__pr__resN', NEIGHBOUR, '__pr__gn');

// Бронь 1 — ТРОЄ, зірка на першому (як її ставить екран сьогодні).
await reg('__pr__r1a', ORG, '__pr__res1', '__pr__g1', true);
await reg('__pr__r1b', ORG, '__pr__res1', '__pr__g2', false);
await reg('__pr__r1c', ORG, '__pr__res1', '__pr__g3', false);
// Бронь 2 того самого готелю — ДВОЄ, своя зірка. Вона не має ворухнутись.
await reg('__pr__r2a', ORG, '__pr__res2', '__pr__g4', true);
await reg('__pr__r2b', ORG, '__pr__res2', '__pr__g5', false);
// Сусід.
await reg('__pr__rna', NEIGHBOUR, '__pr__resN', '__pr__gn', true);

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

/** Хто зі списку броні має зірку. Про КІЛЬКІСТЬ, не про перший знайдений (AGENTS §7). */
const starred = (org: string, resId: string) => runWithOrganization(org, async () => {
  const rows = await sql.rows<{ id: string; is_primary: unknown }>(
    'SELECT id, is_primary FROM guest_registrations WHERE reservation_id = ? ORDER BY id', [resId]);
  return rows.filter((r) => r.is_primary === true || Number(r.is_primary) === 1).map((r) => r.id);
});

await runWithOrganization(ORG, async () => {
  // ── Контроль: засів такий, як задумано ─────────────────────────────────
  say(JSON.stringify(await starred(ORG, '__pr__res1')) === JSON.stringify(['__pr__r1a']),
    'до зміни заявник — перший');

  // ── 1. Зірка ПЕРЕЇЖДЖАЄ, а не додається ───────────────────────────────
  const moved = await setPrimaryRegistration({ organizationId: ORG, reservationId: '__pr__res1', registrationId: '__pr__r1c' });
  say(moved, 'зміна заявника прийнята');
  const after1 = await starred(ORG, '__pr__res1');
  say(after1.length === 1, `заявник РІВНО один, а не ${after1.length} — інакше документ підпише невідомо хто`);
  say(after1[0] === '__pr__r1c', `і це саме третій (${after1[0]})`);

  // ── 2. Сусідня бронь ТОГО САМОГО готелю не ворухнулась ─────────────────
  const other = await starred(ORG, '__pr__res2');
  say(other.length === 1 && other[0] === '__pr__r2a',
    `друга бронь готелю лишилась зі своїм заявником (${other.join(',') || 'жодного'})`);

  // ── 3. Повторна зміна на того самого — і далі рівно один ───────────────
  await setPrimaryRegistration({ organizationId: ORG, reservationId: '__pr__res1', registrationId: '__pr__r1c' });
  const again = await starred(ORG, '__pr__res1');
  say(again.length === 1 && again[0] === '__pr__r1c', `повтор нічого не ламає (${again.length})`);

  // ── 4. Рядок ІНШОЇ броні — «немає», і нічого не переставлено ───────────
  const wrongStay = await setPrimaryRegistration({ organizationId: ORG, reservationId: '__pr__res1', registrationId: '__pr__r2b' });
  say(!wrongStay, 'рядок чужої броні не стає заявником цієї');
  const untouched1 = await starred(ORG, '__pr__res1');
  const untouched2 = await starred(ORG, '__pr__res2');
  say(untouched1.length === 1 && untouched1[0] === '__pr__r1c'
    && untouched2.length === 1 && untouched2[0] === '__pr__r2a',
    'відмова НІЧОГО не переставила на жодній із двох броней');
});

// ── 5. Вісь орендаря: рядок сусіда, названий нами ─────────────────────────
await runWithOrganization(ORG, async () => {
  const alien = await setPrimaryRegistration({ organizationId: ORG, reservationId: '__pr__resN', registrationId: '__pr__rna' });
  say(!alien, 'бронь сусіда — «немає»');
});
await runWithOrganization(NEIGHBOUR, async () => {
  const his = await starred(NEIGHBOUR, '__pr__resN');
  say(his.length === 1 && his[0] === '__pr__rna', `у сусіда все як було (${his.length})`);
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\nprimary-registration: ${fails.length} червоних`); process.exit(1); }
console.log('primary-registration: заявник переїжджає, лишається рівно один, сусідні броні й сусідній готель не ворушаться');
