#!/usr/bin/env node
/**
 * Повний синк (П5) проти живого staging — дверима модуля, з читанням назад.
 *
 *   APP_SECRET_KEY=… CHANNEX_API_KEY=… node scripts/channex-full-sync-live.mjs --org <orgId> <connId> [--confirm]
 *
 * Без `--confirm` — лише звіт: що в черзі, коли був останній повний синк.
 * З `--confirm` — те саме, що кнопка «Повний синк (500 ночей)» у майстрі:
 * `fullSyncConnectionFor` кладе один діапазон на тип і на пару до горизонту
 * й робить один прохід. Стверджується:
 *
 *   1. викликів рівно ДВА — по одному на смугу (тест 1 сертифікації);
 *   2. усе поїхало — дата завершення на зʼєднанні, розписки по одній на смугу;
 *   3. читання назад (И27) — сирим GET повз наш клієнт на чотирьох датах
 *      уздовж горизонту (+1, +60, +250, +499): наявність і ціна лежать;
 *   4. звірка дверима (П6) на вікні 90 ночей — розбіжностей нуль.
 *
 * Інваріант 25: лише СВОЄ зʼєднання і свій обʼєкт. Інваріант 28: відповіді
 * лягають зразками в docs/vendor/channex/live/.
 */
import './lib/module-aliases.mjs';
import { sampleRecorder } from './lib/channex-samples.mjs';

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
let organizationId = null;
let connectionId = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--org') { organizationId = argv[++i]; continue; }
  if (argv[i].startsWith('--')) continue;
  connectionId = argv[i];
}
if (!organizationId || !connectionId) {
  console.error('usage: node scripts/channex-full-sync-live.mjs --org <orgId> <connId> [--confirm]');
  process.exit(2);
}
const apiKey = process.env.CHANNEX_API_KEY;
if (!apiKey) { console.error('немає CHANNEX_API_KEY в оточенні'); process.exit(2); }
const environment = process.env.CHANNEX_ENV === 'production' ? 'production' : 'staging';
const BASE = environment === 'production' ? 'https://app.channex.io/api/v1' : 'https://staging.channex.io/api/v1';

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

const { runWithOrganization } = await import('@core/auth/tenant-context');
const {
  channelConnection, pendingChannelChanges, fullSyncConnectionFor, verifyConnectionSendsFor, recordVendorResponses,
} = await import('@channels');
recordVendorResponses(sampleRecorder());

/** Сире читання повз наш клієнт: звірка мусить бачити відповідь, а не наше тлумачення. */
async function readDay(remotePropertyId, date) {
  const res = await fetch(`${BASE}/restrictions?filter[property_id]=${remotePropertyId}&filter[date]=${date}&filter[restrictions]=availability,rate,stop_sell`,
    { headers: { 'user-api-key': apiKey } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET /restrictions ${date}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text).data ?? {};
}

await runWithOrganization(organizationId, async () => {
  const connection = await channelConnection(connectionId);
  if (!connection) { console.error(`✗ зʼєднання ${connectionId} не наше або не існує`); process.exitCode = 1; return; }
  if (!connection.remotePropertyId) { console.error('✗ обʼєкт ще не заведено — спершу каталог'); process.exitCode = 1; return; }
  console.log('═'.repeat(74));
  console.log(`ЗʼЄДНАННЯ ${connectionId} (обʼєкт ${connection.propertyId} → ${connection.remotePropertyId}, ${environment}), увімкнено: ${connection.isEnabled}`);
  console.log(`останній повний синк: ${connection.lastFullSyncAt ?? '—'}; у черзі: наявність ${await pendingChannelChanges(connectionId, 'availability')}, ціни ${await pendingChannelChanges(connectionId, 'rate')}`);
  console.log('═'.repeat(74));
  if (!CONFIRM) { console.log('\n  (це звіт: без --confirm нічого не кладеться в чергу і не шлеться)'); return; }
  if (!connection.isEnabled) { console.error('✗ зʼєднання вимкнене — батчер не шле; увімкніть розсилку'); process.exitCode = 1; return; }

  // ── 1–2. Повний синк дверима ────────────────────────────────────────────
  const t0 = Date.now();
  const r = await fullSyncConnectionFor(connectionId);
  console.log(`\nПОВНИЙ СИНК (${((Date.now() - t0) / 1000).toFixed(1)} с): у чергу ${r.plan.unitTypes} типів + ${r.plan.pairs} пар, ${r.plan.from}…${r.plan.to}`);
  console.log(`  прохід: викликів ${r.flush.calls}, відправлено ${r.flush.sent}, повернуто ${r.flush.failed}, знято ${r.flush.retired}, потребує уваги ${r.flush.needsAttention}`);
  for (const e of r.flush.errors) console.log(`  ! ${e}`);
  console.log(`  розписки: ${r.receipts.join(', ') || '—'}`);
  console.log(`  завершено: ${r.completedAt ?? 'НІ'}`);
  console.log(`  1. рівно два виклики:      ${r.flush.calls === 2 ? '✓' : `✗ (${r.flush.calls})`}`);
  console.log(`  2. усе поїхало, дата є:    ${r.completedAt && r.flush.failed === 0 ? '✓' : '✗'}`);
  if (r.flush.calls !== 2 || !r.completedAt) process.exitCode = 1;

  // ── 3. Читання назад уздовж горизонту, повз наш клієнт ─────────────────
  console.log('\nЧИТАННЯ НАЗАД (сирий GET):');
  await sleep(3000);
  let dead = 0;
  for (const offset of [1, 60, 250, 499]) {
    const date = addDays(today, offset);
    const day = await readDay(connection.remotePropertyId, date);
    const options = Object.entries(day);
    const cells = options.map(([opt, byDate]) => byDate[date]).filter(Boolean);
    const withRate = cells.filter((c) => Number(c.rate) > 0).length;
    const open = cells.filter((c) => c.stop_sell === false).length;
    const avail = cells.map((c) => c.availability);
    console.log(`  ${date} (+${offset}): опцій ${cells.length}, з ціною ${withRate}, відкрито ${open}, наявність [${[...new Set(avail)].join(',')}]`);
    if (cells.length === 0) dead++;
  }
  console.log(`  3. кожна з чотирьох дат має клітинки: ${dead === 0 ? '✓' : `✗ (${dead} без)`}`);
  if (dead) process.exitCode = 1;

  // ── 4. Звірка дверима на вікні 90 ночей ────────────────────────────────
  let v = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(attempt === 0 ? 1500 : 2500);
    v = await verifyConnectionSendsFor(connectionId, { minAgeSeconds: 0, limit: r.plan.unitTypes + r.plan.pairs });
    if (v.mismatches.length === 0) break;
  }
  const unverified = v.unverified.map((u) => `${u.field}×${u.count}`).join(', ') || '—';
  console.log(`\nЗВІРКА (${v.window ? `${v.window.from}…${v.window.to}` : 'нема чого'}): порівняно ${v.checked}, збігається ${v.matched}, розбіжностей ${v.mismatches.length}, поза горизонтом ${v.beyond}, повернуто в чергу ${v.requeued}, не звірено ${unverified}`);
  for (const m of v.mismatches.slice(0, 8)) console.log(`  ! ${m.date} ${m.ratePlanId ?? ''}×${m.unitTypeId} occ${m.occupancy ?? '-'} ${m.field}: ${m.ours} ≠ ${m.theirs}`);
  console.log(`  4. звірка без розбіжностей: ${v.mismatches.length === 0 && v.checked > 0 ? '✓' : '✗'}`);
  if (v.mismatches.length || v.checked === 0) process.exitCode = 1;

  console.log(`\n  ${process.exitCode ? '✗ НЕ ЗІЙШЛОСЯ' : '✓ ЗІЙШЛОСЯ: 500 ночей двома викликами, лежить і читається назад'}`);
});
