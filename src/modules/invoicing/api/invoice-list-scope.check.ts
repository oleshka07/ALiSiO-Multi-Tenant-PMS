/**
 * Список фактур — фактури ОБРАНОГО обʼєкта (INC-029).
 *
 *   node src/modules/invoicing/api/invoice-list-scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `listInvoices` не мав осі навіть параметром: перший аргумент звався
 * `_request` і не читався взагалі, а запит обмежувався `i.organization_id = ?`
 * — вісь ОРЕНДАРЯ. Готель із двома будинками бачив в одному списку фактури
 * обох, маючи вибраним один.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Спільна фікстура, одна організація і два обʼєкти: орендар тут ні до чого.
 * Фактур 2 в А і 3 у Б — числа різні й несумісні, сума 5 не дорівнює жодному.
 * Номери фактур несуть імʼя обʼєкта, щоб «взяв чужий список» було видно не
 * лише лічильником, а й рядком.
 *
 * Чужий обʼєкт у параметрі — 404 (інваріант 5), а не порожній список: порожньо
 * і «такого обʼєкта немає» — різні відповіді, і саме їх злиття робить вісь
 * непомітною.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-invoice-list-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { listInvoices } = await import('./invoices.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// По фактурі на кожну бронь: 2 в А, 3 у Б.
await runWithOrganization(fx.organizationId, async () => {
  let n = 0;
  for (const [side, ids] of [['А', fx.a.reservationIds], ['Б', fx.b.reservationIds]] as const) {
    for (const reservationId of ids) {
      n += 1;
      await sql.run(
        `INSERT INTO invoices (id, organization_id, reservation_id, invoice_number, issued_at, amount, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT default_currency FROM organizations WHERE id = ?), ?)`,
        [`__inv_scope__${n}`, fx.organizationId, reservationId, `${side}-${n}`, '2026-09-09', 100 * n,
         fx.organizationId, 'issued']);
    }
  }
});

const COUNT_A = fx.a.reservationIds.length;   // 2
const COUNT_B = fx.b.reservationIds.length;   // 3
const COUNT_ALL = COUNT_A + COUNT_B;          // 5
say(COUNT_A !== COUNT_B && COUNT_ALL !== COUNT_A && COUNT_ALL !== COUNT_B,
  `кількості несумісні: А=${COUNT_A}, Б=${COUNT_B}, усі=${COUNT_ALL}`);

const actor = { organizationId: fx.organizationId } as never;
const list = (scope: string) => runWithOrganization(fx.organizationId, async () => {
  const res = await listInvoices(
    { url: `http://local/api/invoices?property_id=${scope}` } as never, null, actor) as Response;
  const body = await res.json() as { invoice_number: string }[] | { error: string };
  return { status: res.status, rows: Array.isArray(body) ? body : [] };
});

const a = await list(fx.a.id);
say(a.rows.length === COUNT_A, `фактур обʼєкта А = ${COUNT_A}, отримали ${a.rows.length}`);
say(a.rows.every((r) => r.invoice_number.startsWith('А-')),
  `у списку А лише його номери (${a.rows.map((r) => r.invoice_number).join(', ') || 'порожньо'})`);

const b = await list(fx.b.id);
say(b.rows.length === COUNT_B, `фактур обʼєкта Б = ${COUNT_B}, отримали ${b.rows.length}`);

const all = await list('all');
say(all.rows.length === COUNT_ALL,
  `сказане «усі обʼєкти» дає ${COUNT_ALL}, отримали ${all.rows.length}`);

const alien = await list('__two_props__not_ours');
say(alien.status === 404,
  `чужий обʼєкт — 404, а не порожній список (статус ${alien.status})`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\ninvoice-list-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`invoice-list-scope: ${COUNT_A} в А, ${COUNT_B} у Б, ${COUNT_ALL} «усі», чужий обʼєкт — 404`);
assert.ok(true);
