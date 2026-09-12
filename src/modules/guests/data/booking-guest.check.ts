/**
 * Названий гість — це названий гість, а не привід вгадати ще раз.
 *
 *   node src/modules/guests/data/booking-guest.check.ts
 *
 * ── Вісь, по якій фікстура не вироджена (інваріант 26) ──────────────────
 *
 * Головна вісь тут — «назвали / не назвали», і по ній обидва значення є.
 * Але сама по собі вона нічого не доводить: щоб «названий береться як
 * названий» було змістовним, у базі мусить бути ДРУГИЙ рядок, на який
 * вгадування перейшло б. Тому двоє ОДНОФАМІЛЬЦІВ без пошти й телефону —
 * рівно та пара, яку ланцюжок дедупу зводить в одного (остання ланка:
 * збіг за іменем), і на якій видно різницю між вибором і здогадом.
 *
 * Друга вісь — орендар: два готелі, і гість сусіда мусить бути невидимим.
 * З одним готелем це твердження зелене і на коді, який орендаря не питає.
 *
 * Третя — живий рядок проти злитого: злиття лишає слід, і назвати слід
 * можна лише зі старого екрана.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-booking-guest-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { resolveBookingGuest } = await import('./booking-guest.repo.ts');
const { isRefusal } = await import('@core/http/refusal.ts');

const sql = getSql();
const A = '__bg__org_a';
const B = '__bg__org_b';

await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [A, 'A', A]);
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [B, 'B', B]);

// ДВА однофамільці в готелі А, обидва без пошти й телефону — рівно те, що
// ланцюжок дедупу зводить в одного.
await runWithOrganization(A, async () => {
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__bg__ivan1', A, 'Іван', 'Петренко']);
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__bg__ivan2', A, 'Іван', 'Петренко']);
  // Злитий слід: людина, яку звели в `ivan1`.
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name, merged_into) VALUES (?, ?, ?, ?, ?)',
    ['__bg__ghost', A, 'Іван', 'Петренко-старий', '__bg__ivan1']);
});
await runWithOrganization(B, () => sql.run(
  'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  ['__bg__neighbour', B, 'Сусід', 'Сусідов']));

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

await runWithOrganization(A, async () => {
  const base = { organizationId: A, firstName: 'Іван', lastName: 'Петренко' };

  // ── 1. Не назвали — усе як було: вгадування, і воно бере ПЕРШОГО ────────
  const guessed = await resolveBookingGuest(base);
  say(guessed.matchedBy === 'name' && guessed.id === '__bg__ivan1',
    `без вибору ланцюжок вгадує за іменем і бере першого (${guessed.matchedBy}, ${guessed.id})`);

  // ── 2. Назвали ДРУГОГО однофамільця — має бути саме він ────────────────
  //
  // Це і є твердження заради якого модуль існує: вгадування дало б `ivan1`,
  // тобто ЧУЖУ людину з тим самим іменем.
  const chosen = await resolveBookingGuest({ ...base, guestId: '__bg__ivan2' });
  say(chosen.id === '__bg__ivan2' && chosen.matchedBy === 'chosen',
    `названий другий однофамілець береться як названий (${chosen.id})`);
  say(guessed.id !== chosen.id,
    'вибір і здогад дають РІЗНИХ людей — інакше твердження вище нічого не варте');

  // ── 3. Гість СУСІДА — не знаходиться ───────────────────────────────────
  let neighbourRefused = false; let neighbourStatus = 0;
  try {
    await resolveBookingGuest({ ...base, guestId: '__bg__neighbour' });
  } catch (e) {
    neighbourRefused = true;
    neighbourStatus = isRefusal(e) ? (e as { status: number }).status : 0;
  }
  say(neighbourRefused && neighbourStatus === 404,
    `чужий гість — названа відмова 404, не мовчазна підміна (статус ${neighbourStatus})`);

  // ── 4. Злитий рядок — відмова, а не тиха підміна на живого ─────────────
  //
  // `findOrCreateGuest` тут навмисно переходить на `merged_into`; для вибору
  // це неправильно: показали один рядок, записали інший.
  let ghostRefused = false; let ghostStatus = 0; let ghostMsg = '';
  try {
    await resolveBookingGuest({ ...base, guestId: '__bg__ghost' });
  } catch (e) {
    ghostRefused = true;
    ghostStatus = isRefusal(e) ? (e as { status: number }).status : 0;
    ghostMsg = String((e as Error).message);
  }
  say(ghostRefused && ghostStatus === 409, `злитий рядок — відмова 409 (статус ${ghostStatus})`);
  say(/злито/.test(ghostMsg), 'і речення каже портьє, що робити');

  // ── 5. Порожній вибір — це НЕ вибір ────────────────────────────────────
  for (const empty of [null, undefined, '', '   ']) {
    const r = await resolveBookingGuest({ ...base, guestId: empty as never });
    say(r.matchedBy !== 'chosen', `порожній вибір (${JSON.stringify(empty)}) не вдає названого`);
  }
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\nbooking-guest: ${fails.length} червоних`); process.exit(1); }
console.log('booking-guest: названий гість береться як названий; чужий і злитий — названі відмови');
