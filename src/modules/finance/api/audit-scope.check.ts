/**
 * Фінансовий аудит рахує ВЛАСНІ броні — а не всі на сервері (INC-039).
 *
 *   node src/modules/finance/api/audit-scope.check.ts
 *
 * ── Що знайшлося ────────────────────────────────────────────────────────
 *
 * Знайдено при переведенні осі обʼєкта, і виявилось не про неї: два запити в
 * `getFinanceAudit` не мають орендаря ВЗАГАЛІ.
 *
 *   1. розділ «Фантомні paid резервації» — `FROM reservations r LEFT JOIN
 *      guests g … WHERE r.payment_status = 'paid' …`, і жодного
 *      `organization_id`. Віддає до 50 рядків із **іменами гостей**;
 *   2. підсумок унизу — `(SELECT COUNT(*) FROM reservations) AS reservations`,
 *      теж без орендаря.
 *
 * Рід INC-014, і саме тому це прожило: на Postgres політика ховає чуже, і в
 * проді видно тільки своє. На SQLite політик немає — а SQLite це вся розробка,
 * `npm run dev` і майже весь гейт-парк. Тобто екран, який власник відкриває
 * ПЕРЕВІРИТИ свої книги, показував чужі броні на кожній машині розробника і в
 * кожному середовищі без Postgres.
 *
 * Число «Резервацій» у підсумку при цьому неправильне навіть на Postgres у
 * своєму власному сенсі: воно рахує все, що видно ролі, а не те, що належить
 * готелю, — і жоден інший рядок того підсумку так не рахується.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Тут вирішальна вісь — ОРЕНДАР, а не обʼєкт, тож фікстура має сусідню
 * організацію. Своїх броней 5 (2 в обʼєкті А, 3 у Б), сусідських 2 — числа
 * несумісні: 5, 2 і 7 не сплутати. Фантомні броні засіяні по одній з кожного
 * боку, тож «побачив чуже» видно і лічильником, і **імʼям гостя** в рядку.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-audit-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { getFinanceAudit } = await import('./audit.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const MINE = fx.totalReservations;      // 5
const THEIRS = 2;

// Сусідські броні — з гостем, чиє імʼя не сплутати.
await runWithOrganization(neighbour.organizationId, async () => {
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__audit__gn', neighbour.organizationId, 'Сусід', 'Сусідов']);
  for (let i = 1; i <= THEIRS; i++) {
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                                 check_in, check_out, nights, adults, total_price, currency,
                                 status, payment_status, is_prepaid)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'EUR', 'confirmed', 'paid', FALSE)`,
      [`__audit__rn${i}`, neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0],
       '__audit__gn', `2026-09-2${i}`, `2026-09-2${i + 1}`, 500]);
  }
});

// Своя фантомна бронь: помічена paid, без жодної операції.
await runWithOrganization(fx.organizationId, () => sql.run(
  `UPDATE reservations SET payment_status = 'paid', is_prepaid = FALSE, status = 'confirmed'
    WHERE id = ?`, [fx.a.reservationIds[0]]));

say(MINE !== THEIRS && MINE + THEIRS !== MINE && MINE + THEIRS !== THEIRS,
  `числа несумісні: своїх ${MINE}, сусідських ${THEIRS}, разом ${MINE + THEIRS}`);

const actor = { organizationId: fx.organizationId } as never;
const audit = await runWithOrganization(fx.organizationId, async () => {
  const res = await getFinanceAudit(
    { url: 'http://local/api/finance/audit' } as never, null as never, actor) as Response;
  return await res.json() as any;
});

// ── Підсумок «Резервацій» рахує СВОЇ ───────────────────────────────────────

say(Number(audit?.totals?.reservations) === MINE,
  `у підсумку аудиту ${MINE} своїх броней, отримали ${audit?.totals?.reservations}`);

// ── Розділ фантомних не показує чужих гостей ───────────────────────────────

const phantom = (audit?.sections || []).find((s: any) => s.key === 'phantom_paid');
const rows = (phantom?.details || []) as { guest_name?: string }[];
say(Boolean(phantom), 'розділ «Фантомні paid» у відповіді є');
say(!rows.some((r) => String(r.guest_name || '').includes('Сусідов')),
  `імені гостя сусіда в аудиті немає (рядків ${rows.length}: ${rows.map((r) => r.guest_name).join(', ') || '—'})`);
say(rows.length >= 1,
  'своя фантомна бронь у розділі Є — інакше «чужого немає» істинне й на порожньому розділі');

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\naudit-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`audit-scope: аудит рахує ${MINE} своїх броней і не показує гостей сусіда`);
assert.ok(true);
