/**
 * Рахунок знає, на КОГО з гостей броні він виписаний.
 *
 *   node src/modules/invoicing/data/folio-guest.check.ts
 *
 * ── Дефект, проти якого це написано ─────────────────────────────────────
 *
 * Розбити рахунок між кількома фізособами продукт умів: `fin_folios` це
 * кілька рахунків на одну бронь, рядок нарахування переноситься між ними,
 * фактура виписується НА ФОЛІО. Але колонка `fin_folios.guest_id` існувала
 * з першого дня й НЕ МАЛА ЖОДНОГО ПИСАЧА: «другий платник» був рядком, який
 * портьє набирав руками. Тобто питання «чия частка лишилась несплаченою»
 * впиралось у збіг написання прізвища.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. Гість НАШ і гість СУСІДА. Без другого твердження «звʼязок записався»
 *    зелене й на писачі, який пише будь-який переданий ідентифікатор — а це
 *    імʼя чужої людини на нашій фактурі.
 * 2. Відмова НІЧОГО не лишає: напівстворений рахунок без платника гірший за
 *    відсутній, бо на нього вже можна перенести рядки.
 * 3. Рахунок БЕЗ гостя (вільне імʼя) лишається дозволеним: батько платить за
 *    дитину, друг закриває бар — такої людини в броні немає взагалі.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-folio-guest-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { createFolio } = await import('./folio.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;
const RES = fx.a.reservationIds[0];

const NEIGHBOUR = await seedNeighbourOrganization();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// Наш гість і гість сусіда — з однаковим прізвищем навмисно: якби писач
// звіряв імена замість орендаря, ця пара його б не спинила.
await runWithOrganization(ORG, () => sql.run(
  'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
  ['__fg__ours', ORG, 'Іван', 'Однофамілець']));
await runWithOrganization(NEIGHBOUR.organizationId, () => sql.run(
  'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
  ['__fg__alien', NEIGHBOUR.organizationId, 'Іван', 'Однофамілець']));

const foliosOf = (org: string) => runWithOrganization(org, async () =>
  (await sql.row<{ n: number }>(
    'SELECT COUNT(*) AS n FROM fin_folios WHERE organization_id = ?', [org]))!.n);

await runWithOrganization(ORG, async () => {
  // ── 1. Наш гість: звʼязок записався ────────────────────────────────────
  const id = await createFolio({
    reservationId: RES, payerKind: 'guest',
    payerName: 'Однофамілець Іван', guestId: '__fg__ours',
  });
  const row = await sql.row<any>('SELECT guest_id, payer_name FROM fin_folios WHERE id = ?', [id]);
  say(row?.guest_id === '__fg__ours',
    `рахунок знає свого гостя (${row?.guest_id ?? 'порожньо'})`);
  say(row?.payer_name === 'Однофамілець Іван',
    'і знімок імені лишився — документ називає того, кого назвали при виписці');

  // ── 2. Гість сусіда: відмова, і НІЧОГО не створено ─────────────────────
  const before = await foliosOf(ORG);
  let refused = false;
  try {
    await createFolio({ reservationId: RES, payerKind: 'guest', payerName: 'Чужий', guestId: '__fg__alien' });
  } catch (e: any) {
    refused = e?.message === 'guest_not_found';
  }
  say(refused, 'гість сусіда — названа відмова, а не тихий запис чужого ідентифікатора');
  say(await foliosOf(ORG) === before,
    `і рахунку не зʼявилось: було ${before}, стало ${await foliosOf(ORG)}`);

  // ── 3. Вільне імʼя без гостя лишається дозволеним ──────────────────────
  //
  // Батько платить за дитину, друг закриває бар: такої людини в броні немає,
  // і забороняти це означало б зламати те, що працює.
  const freeId = await createFolio({ reservationId: RES, payerKind: 'guest', payerName: 'Батько гостя' });
  const free = await sql.row<any>('SELECT guest_id, payer_name FROM fin_folios WHERE id = ?', [freeId]);
  say(free?.guest_id === null && free?.payer_name === 'Батько гостя',
    `рахунок на особу поза бронню — без звʼязку, але з іменем (${free?.guest_id ?? 'null'})`);

  // ── 4. Неіснуючий ідентифікатор — так само відмова ─────────────────────
  let ghost = false;
  try {
    await createFolio({ reservationId: RES, payerKind: 'guest', payerName: 'Привид', guestId: 'g_nope' });
  } catch (e: any) { ghost = e?.message === 'guest_not_found'; }
  say(ghost, 'ідентифікатор, якого немає ніде, теж відмова (інваріант 13)');
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\nfolio-guest: ${fails.length} червоних`); process.exit(1); }
console.log('folio-guest: рахунок звʼязаний зі СВОЇМ гостем, чужий відмовлено, вільне імʼя лишилось можливим');
