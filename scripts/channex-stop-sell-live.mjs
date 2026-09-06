#!/usr/bin/env node
/**
 * Живий вимір: що робить прапорець продажу при НУЛЬОВІЙ наявності.
 *
 *   APP_SECRET_KEY=… CHANNEX_API_KEY=… node scripts/channex-stop-sell-live.mjs --org <orgId> <connId> --confirm
 *
 * Питання (02.09.2026, рецензія П6): поки наявність типу нуль, вендор віддає
 * `stop_sell: true` попри наш `false` із ціною. Чи ЗБЕРІГАЄ він той `false`,
 * щоб зняти прапорець, коли наявність зросте, — чи ігнорує, і тоді номер із
 * живою наявністю й живою ціною лишається закритим у каналі назавжди, бо
 * координата ціни не змінилась і `false` ніхто не повторить?
 *
 * Чотири кроки на одній парі, дві далекі дати (за горизонтом звірки), сирі
 * виклики повз нашу чергу, читання назад після кожного (И27):
 *
 *   D : наявність 0 + `stop_sell: true`      → очікуємо закрито
 *   D : ціни + `stop_sell: false` при нулі   → що віддає? (звіт)
 *   D : наявність 4, БЕЗ повтору `false`     → ГОЛОВНЕ: знялось чи ні
 *   D2: наявність 0 + `true`, потім 4 без `false` → чи знімає сама наявність
 *
 * Наприкінці обидві дати повертаються в стан «наявність 4, ціни, відкрито».
 * Інваріант 25: лише своє зʼєднання і свій обʼєкт.
 */
import './lib/module-aliases.mjs';

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
  console.error('usage: node scripts/channex-stop-sell-live.mjs --org <orgId> <connId> --confirm');
  process.exit(2);
}
const apiKey = process.env.CHANNEX_API_KEY;
if (!apiKey) { console.error('немає CHANNEX_API_KEY в оточенні'); process.exit(2); }
const BASE = process.env.CHANNEX_ENV === 'production' ? 'https://app.channex.io/api/v1' : 'https://staging.channex.io/api/v1';

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const D = addDays(today, 400);
const D2 = addDays(today, 401);

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { channelConnection, connectionMirror } = await import('@channels/live');

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'user-api-key': apiKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return payload;
}

await runWithOrganization(organizationId, async () => {
  const connection = await channelConnection(connectionId);
  if (!connection?.remotePropertyId) { console.error('✗ зʼєднання не наше або без обʼєкта'); process.exitCode = 1; return; }
  const remote = connection.remotePropertyId;
  const mirror = await connectionMirror(connectionId);
  const unitType = mirror.find((m) => m.entityType === 'unit_type');
  const pair = mirror.find((m) => m.entityType === 'rate_plan' && m.unitTypeId === unitType.localId);
  const options = mirror.filter((m) => m.entityType === 'rate_plan_option' && m.localId === pair.localId && m.unitTypeId === unitType.localId && m.occupancy > 0)
    .sort((a, b) => a.occupancy - b.occupancy);
  // Без опцій нема чим ні читати, ні цінувати: писати з порожнім `rates` не можна.
  if (options.length === 0) { console.error('✗ у дзеркалі немає опцій заселеності цієї пари — нічого не пишеться'); process.exitCode = 1; return; }
  console.log('═'.repeat(74));
  console.log(`ЗʼЄДНАННЯ ${connectionId} → ${remote}; тип ${unitType.localId} → ${unitType.remoteId}; пара ${pair.localId} → ${pair.remoteId}; опцій ${options.length}`);
  console.log(`дати: D=${D}, D2=${D2}`);
  console.log('═'.repeat(74));
  if (!CONFIRM) { console.log('\n  (без --confirm нічого не пишеться)'); return; }

  const read = async (date) => {
    const body = await api('GET', `/restrictions?filter[property_id]=${remote}&filter[date]=${date}&filter[restrictions]=availability,rate,stop_sell`);
    const cells = options.map((o) => body.data?.[o.remoteId]?.[date]).filter(Boolean);
    if (cells.length === 0) return { availability: '?', stop: '?', rate: '?' };
    return {
      availability: [...new Set(cells.map((c) => c.availability))].join('/'),
      stop: [...new Set(cells.map((c) => String(c.stop_sell)))].join('/'),
      rate: [...new Set(cells.map((c) => c.rate))].join('/'),
    };
  };
  /** Читати, доки стан не стане очікуваним або не мине ~25 с: вендор кладе задачі асинхронно. */
  const settle = async (date, want) => {
    let last = null;
    for (let i = 0; i < 10; i++) {
      await sleep(i === 0 ? 1500 : 2500);
      last = await read(date);
      if (!want || Object.entries(want).every(([k, v]) => last[k] === v)) break;
    }
    return last;
  };
  const rates = options.map((o) => ({ occupancy: o.occupancy, rate: 150000 + 50000 * (o.occupancy - 1) }));
  const availability = (date, n) => api('POST', '/availability', { values: [{ property_id: remote, room_type_id: unitType.remoteId, date_from: date, date_to: date, availability: n }] });
  const restrictions = (date, v) => api('POST', '/restrictions', { values: [{ property_id: remote, rate_plan_id: pair.remoteId, date_from: date, date_to: date, ...v }] });
  const row = (label, s) => console.log(`  ${label.padEnd(46)} наявність ${String(s.availability).padEnd(4)} stop_sell ${String(s.stop).padEnd(6)} rate ${s.rate}`);

  console.log('\nБАЗА:');
  row(`D  до всього`, await read(D));
  row(`D2 до всього`, await read(D2));

  console.log('\nD — закрити при нулі, послати false при нулі, підняти наявність:');
  await availability(D, 0);
  await restrictions(D, { stop_sell: true });
  row('1. наявність 0 + stop_sell true', await settle(D, { availability: '0', stop: 'true' }));
  await restrictions(D, { stop_sell: false, rates });
  const afterFalseAtZero = await settle(D, { stop: 'false' });
  row('2. ціни + stop_sell false при нулі', afterFalseAtZero);
  await availability(D, 4);
  const afterRise = await settle(D, { availability: '4', stop: 'false' });
  row('3. наявність 4, БЕЗ повтору false', afterRise);

  console.log('\nD2 — закрити при нулі, підняти наявність без жодного false:');
  await availability(D2, 0);
  await restrictions(D2, { stop_sell: true });
  row('4а. наявність 0 + stop_sell true', await settle(D2, { availability: '0', stop: 'true' }));
  await availability(D2, 4);
  const riseAlone = await settle(D2, { availability: '4', stop: 'false' });
  row('4б. наявність 4, false не слали', riseAlone);

  console.log('\nВИСНОВОК:');
  const stored = afterRise.stop === 'false';
  const autoLift = riseAlone.stop === 'false';
  console.log(`  false при нульовій наявності ${stored ? 'ЗБЕРІГАЄТЬСЯ: після зростання наявності канал відкритий' : 'ІГНОРУЄТЬСЯ: після зростання наявності канал ЛИШИВСЯ закритим'}`);
  console.log(`  саме зростання наявності прапорець ${autoLift ? 'ЗНІМАЄ' : 'НЕ знімає'} (D2 без жодного false: ${riseAlone.stop})`);
  console.log(`  читання при нулі показує stop_sell=${afterFalseAtZero.stop} — ${afterFalseAtZero.stop === 'true' ? 'звіт про ЕФЕКТ (нема чого продавати), не про збережений прапорець' : 'збережений прапорець'}`);
  if (!stored) { console.log('  ! ДЕФЕКТ КЛАСУ «мовчить назавжди»: зростання наявності з нуля мусить ставити в чергу й координату ціни пари'); process.exitCode = 1; }

  console.log('\nПРИБИРАННЯ — обидві дати назад у «наявність 4, ціни, відкрито»:');
  for (const date of [D, D2]) {
    await restrictions(date, { stop_sell: false, rates });
    await availability(date, 4);
    row(`${date}`, await settle(date, { availability: '4', stop: 'false' }));
  }
});
