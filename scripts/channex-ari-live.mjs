/**
 * Один прохід батчера ARI проти ЖИВОГО менеджера каналів — і читання назад.
 *
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId>                 # звіт: що поїхало б, що там зараз
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId> --confirm       # поставити в чергу, прогнати, прочитати назад
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId> --probe-429     # довести, що 429 повертає координату в чергу
 *   … [--from YYYY-MM-DD] [--days N]                                         # дати (дефолт: +30 днів, 3 доби)
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * Батчер (`domain/ari-batch.ts`) доведений шістнадцятьма твердженнями на
 * стенді в памʼяті — і жодного разу не розмовляв із вендором. Рецензія
 * 01.09.2026 назвала це найбільшою прогалиною фази 4, і поставила три
 * питання, на які відповідає тільки живий API:
 *
 *   1. ціна справді лягла?           — `GET /restrictions` після проходу
 *   2. `stop_sell` справді знявся?    — той самий запит (И14)
 *   3. `429` справді повернув координату в чергу? — черга після відмови
 *
 * Це робиться ДО крона і ДО майстра підключення: крон, який щохвилини
 * повторює непроверене, лише множить помилку.
 *
 * ── Що і як ─────────────────────────────────────────────────────────────
 *
 * Значення, які їдуть, — СПРАВЖНІ: наявність із `availabilityByDay()`, ціни
 * з `priceNights()` по кожній опції заселеності, зсунуті модифікатором
 * зʼєднання (Ц7). Скрипт лише кладе координати в чергу (те, що робитиме
 * доменна транзакція) і кличе один прохід через двері модуля
 * (`flushConnectionOutboxFor`). Очікування він рахує сам, тими самими
 * дверима, — інакше «сходиться» означало б «адаптер погодився сам із собою».
 *
 * Читання назад — сирим `GET`, повз наш клієнт, і за мапою ОПЦІЙ (И13):
 * ключ `data` у відповіді — це опція заселеності, не тариф; ціни неосновних
 * заселеностей інакше нема з чим зіставити.
 *
 * ── Досліди лише на СВОЇХ обʼєктах (інваріант 25) ────────────────────────
 *
 * Акаунт staging спільний. Скрипт пише лише в обʼєкт, на який вказує
 * `cm_connections.remote_property_id` нашого зʼєднання, і лише справжні
 * числа нашого готелю. Після себе нічого не лишає, крім цих чисел.
 *
 * `--probe-429` навмисно перевищує ліміт вендора (10 викликів на хвилину на
 * обʼєкт) — на власному обʼєкті, у смузі наявності, справжніми числами. Він
 * чекає хвилину й доганяє чергу, щоб не лишити координату висіти.
 */
import './lib/module-aliases.mjs';
import { sampleRecorder } from './lib/channex-samples.mjs';

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
const PROBE_429 = argv.includes('--probe-429');
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

let organizationId = null;
let connectionId = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--org') { organizationId = argv[++i]; continue; }
  if (argv[i] === '--from' || argv[i] === '--days') { i++; continue; }
  if (argv[i].startsWith('--')) continue;
  connectionId = argv[i];
}
if (!organizationId || !connectionId) {
  console.error('usage: node scripts/channex-ari-live.mjs --org <orgId> <connId> [--confirm|--probe-429] [--from YYYY-MM-DD] [--days N]');
  console.error('  --org обовʼязковий: зʼєднання читається ЧЕРЕЗ орендаря, не за самим id (INC-010).');
  process.exit(2);
}

const apiKey = process.env.CHANNEX_API_KEY;
if (!apiKey) { console.error('немає CHANNEX_API_KEY в оточенні'); process.exit(2); }
const environment = process.env.CHANNEX_ENV === 'production' ? 'production' : 'staging';
const BASE = environment === 'production'
  ? 'https://app.channex.io/api/v1' : 'https://staging.channex.io/api/v1';

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const today = new Date().toISOString().slice(0, 10);
const FROM = opt('--from', addDays(today, 30));
const DAYS = Math.max(1, Number(opt('--days', 3)) || 3);
const DATES = Array.from({ length: DAYS }, (_, i) => addDays(FROM, i));
const TO = DATES[DATES.length - 1];

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const sql = getSql();
const { percentOf } = await import('@core/money');
const {
  channelConnection, connectionMirror, flushConnectionOutboxFor,
  enqueueChannelChange, pendingChannelChanges, queuedChannelChanges, stuckChannelChanges, recentChannelSends } = await import('@channels');
// Інваріант 28: кожна жива відповідь лягає зразком у docs/vendor/channex/live/.
const { recordVendorResponses } = await import('@channels');
recordVendorResponses(sampleRecorder());
const { availabilityByDay, catalogUnitTypes } = await import('@properties');
const { priceNights } = await import('@pricing');

/** Сире читання повз наш клієнт: звірка мусить бачити відповідь, а не наше тлумачення. */
async function get(path) {
  const res = await fetch(BASE + path, { headers: { 'user-api-key': apiKey } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** `data[optionId][date] = { rate, stop_sell, availability }` — И13. */
async function readCalendar(remotePropertyId, from, to) {
  const body = await get(`/restrictions?filter[property_id]=${remotePropertyId}`
    + `&filter[date][gte]=${from}&filter[date][lte]=${to}&filter[restrictions]=rate,stop_sell,availability`);
  return body.data ?? {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minorToMajor = (minor) => Number((minor / 100).toFixed(2));

await runWithOrganization(organizationId, async () => {
  const connection = await channelConnection(connectionId);
  if (!connection) { console.error(`✗ зʼєднання ${connectionId} не наше або не існує`); process.exitCode = 1; return; }
  if (!connection.remotePropertyId) { console.error('✗ обʼєкт ще не заведено (remote_property_id порожній) — спершу каталог'); process.exitCode = 1; return; }
  const remote = connection.remotePropertyId;
  const modifier = Number(connection.pricingModifierPercent) || 0;

  console.log('═'.repeat(74));
  console.log(`ЗʼЄДНАННЯ ${connectionId}  (обʼєкт ${connection.propertyId} → ${remote}, ${environment})`);
  console.log(`дати ${FROM}…${TO} (${DAYS}), модифікатор зʼєднання ${modifier > 0 ? '+' : ''}${modifier}%, увімкнено: ${connection.isEnabled}`);
  console.log('═'.repeat(74));

  // ── Дзеркало: адресати й мапа опцій (И13) ──────────────────────────────
  const mirror = await connectionMirror(connectionId);
  const unitTypes = mirror.filter((m) => m.entityType === 'unit_type');
  const pairs = mirror.filter((m) => m.entityType === 'rate_plan');
  const options = mirror.filter((m) => m.entityType === 'rate_plan_option' && m.occupancy > 0);
  const optionOf = new Map(options.map((o) => [o.remoteId, o]));
  const catalog = await catalogUnitTypes(connection.propertyId);
  const codeOf = new Map(catalog.map((u) => [u.id, u.code]));

  console.log(`\nДЗЕРКАЛО: типів ${unitTypes.length}, пар тип×тариф ${pairs.length}, опцій заселеності ${options.length}`);
  for (const p of pairs) {
    const occ = options.filter((o) => o.localId === p.localId && o.unitTypeId === p.unitTypeId).map((o) => o.occupancy).sort();
    console.log(`  ${p.localId} × ${codeOf.get(p.unitTypeId) ?? p.unitTypeId}  → ${p.remoteId}  [${occ.join(',')}]`);
  }

  // ── Очікування — тими самими дверима, що й адаптер, але окремо ────────
  const free = await availabilityByDay(connection.propertyId, FROM, addDays(TO, 1));
  const expected = new Map(); // optionRemoteId|date → { rate: major|null, closed, availability }
  for (const o of options) {
    for (const date of DATES) {
      const q = await priceNights({ unitTypeId: o.unitTypeId, checkIn: date, nights: 1, adults: o.occupancy, ratePlanId: o.localId });
      const night = q.nights[0];
      let rate = null;
      if (night && q.missing.length === 0) {
        const minor = Number(`${night.price}e2`);
        rate = minorToMajor(minor + percentOf(minor, modifier, 0));
      }
      expected.set(`${o.remoteId}|${date}`, {
        rate, availability: free.get(o.unitTypeId)?.get(date) ?? 0, closed: rate == null,
      });
    }
  }
  // Ніч закривається цілком, якщо бракує ціни хоч на одну опцію пари (шапка адаптера).
  for (const p of pairs) {
    const own = options.filter((o) => o.localId === p.localId && o.unitTypeId === p.unitTypeId);
    for (const date of DATES) {
      if (own.some((o) => expected.get(`${o.remoteId}|${date}`)?.rate == null)) {
        for (const o of own) { const e = expected.get(`${o.remoteId}|${date}`); e.rate = null; e.closed = true; }
      }
    }
  }

  console.log('\nОЧІКУЄМО (наш бік, після зсуву):');
  for (const p of pairs) {
    const own = options.filter((o) => o.localId === p.localId && o.unitTypeId === p.unitTypeId).sort((a, b) => a.occupancy - b.occupancy);
    for (const date of DATES) {
      const cells = own.map((o) => { const e = expected.get(`${o.remoteId}|${date}`); return `occ${o.occupancy}=${e.rate ?? 'ЗАКРИТО'}`; });
      console.log(`  ${date} ${p.localId}×${codeOf.get(p.unitTypeId)}: ${cells.join('  ')}  вільно ${expected.get(`${own[0].remoteId}|${date}`).availability}`);
    }
  }

  // ── ДО ─────────────────────────────────────────────────────────────────
  const before = await readCalendar(remote, FROM, TO);
  const show = (cal, label) => {
    console.log(`\n${label}:`);
    for (const p of pairs) {
      const own = options.filter((o) => o.localId === p.localId && o.unitTypeId === p.unitTypeId).sort((a, b) => a.occupancy - b.occupancy);
      for (const date of DATES) {
        const cells = own.map((o) => {
          const c = cal[o.remoteId]?.[date];
          return c ? `occ${o.occupancy}=${c.rate}${c.stop_sell ? '⛔' : ''}` : `occ${o.occupancy}=?`;
        });
        const av = cal[own[0].remoteId]?.[date]?.availability;
        console.log(`  ${date} ${p.localId}×${codeOf.get(p.unitTypeId)}: ${cells.join('  ')}  вільно ${av ?? '?'}`);
      }
    }
  };
  show(before, 'ДО (живий календар вендора)');

  if (!CONFIRM && !PROBE_429) {
    console.log('\n  (це звіт: без --confirm нічого не ставиться в чергу і не шлеться)');
    return;
  }

  if (CONFIRM) {
    // ── Черга: те, що робитиме доменна транзакція ────────────────────────
    // Одним ДІАПАЗОНОМ на тип і на пару (Ц15) — саме так кладуть писачі;
    // батчер розкладе по ночах сам, а стиснення збере назад у тілі.
    for (const u of unitTypes) {
      await enqueueChannelChange(sql, connectionId, { kind: 'availability', unitTypeId: u.localId, date: FROM, dateTo: TO });
    }
    for (const p of pairs) {
      await enqueueChannelChange(sql, connectionId, { kind: 'rate', unitTypeId: p.unitTypeId, ratePlanId: p.localId, date: FROM, dateTo: TO });
    }
    console.log(`\nУ ЧЕРЗІ: наявність ${await pendingChannelChanges(connectionId, 'availability')}, ціни ${await pendingChannelChanges(connectionId, 'rate')}`);

    // ── Один прохід ──────────────────────────────────────────────────────
    const t0 = Date.now();
    const report = await flushConnectionOutboxFor(connectionId);
    console.log(`\nПРОХІД (${Date.now() - t0} мс): відправлено ${report.sent}, повернуто ${report.failed}, знято ${report.retired}, `
      + `потребує уваги ${report.needsAttention}, викликів ${report.calls}`);
    for (const e of report.errors) console.log(`  ! ${e}`);
    console.log(`  після: у черзі ${await pendingChannelChanges(connectionId)}, застрягло ${(await stuckChannelChanges(connectionId)).length}`);

    // ── ПІСЛЯ: вендор застосовує задачі асинхронно — чекаємо, доки зійдеться або вичерпається час ──
    let after = null;
    let verdict = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(attempt === 0 ? 1500 : 2500);
      after = await readCalendar(remote, FROM, TO);
      verdict = compare(after);
      if (verdict.rateMiss === 0 && verdict.openMiss === 0 && verdict.availMiss === 0) break;
    }
    show(after, 'ПІСЛЯ (живий календар вендора)');
    // П6: розписки вендора на відправлених координатах — те, що йде у форму.
    // Судяться лише рядки ЦЬОГО проходу (найновіші `report.sent`): відправлене
    // до появи колонки розписки не має і мати не може.
    const sent = await recentChannelSends(connectionId, Math.max(10, report.sent));
    const thisPass = sent.slice(0, report.sent);
    console.log(`\nРОЗПИСКИ (цей прохід ${thisPass.length}): ${thisPass.filter((r) => r.receipt).length} з розпискою`);
    for (const r of sent.slice(0, 6)) console.log(`  ${String(r.sentAt).slice(0, 19)} ${r.kind} ${r.date}${r.dateTo ? '–' + r.dateTo : ''} → ${r.receipt ?? '—'}`);
    if (thisPass.some((r) => !r.receipt)) { console.log('  ! відправлене без розписки — задачу вендора нема чим назвати'); process.exitCode = 1; }
    console.log('\nВЕРДИКТ:');
    console.log(`  1. ціна лягла:        ${verdict.rateOk} з ${verdict.rateAll}${verdict.rateMiss ? '   ← РОЗБІЖНІСТЬ' : ''}`);
    console.log(`  2. stop_sell знявся:  ${verdict.openOk} з ${verdict.openAll}${verdict.openMiss ? '   ← ЛИПКИЙ ПРАПОРЕЦЬ (И14)' : ''}`);
    console.log(`     закрито де треба:  ${verdict.closedOk} з ${verdict.closedAll}`);
    console.log(`  3. наявність лягла:   ${verdict.availOk} з ${verdict.availAll}${verdict.availMiss ? '   ← РОЗБІЖНІСТЬ' : ''}`);
    for (const d of verdict.details) console.log(`     ${d}`);
    const ok = !verdict.rateMiss && !verdict.openMiss && !verdict.availMiss && report.failed === 0;
    console.log(`\n  ${ok ? '✓ ЗІЙШЛОСЯ' : '✗ НЕ ЗІЙШЛОСЯ'}`);
    if (!ok) process.exitCode = 1;
  }

  function compare(cal) {
    const v = { rateOk: 0, rateAll: 0, rateMiss: 0, openOk: 0, openAll: 0, openMiss: 0,
      closedOk: 0, closedAll: 0, availOk: 0, availAll: 0, availMiss: 0, details: [] };
    for (const [key, e] of expected) {
      const [optionId, date] = key.split('|');
      const c = cal[optionId]?.[date];
      const o = optionOf.get(optionId);
      const who = `${date} ${o.localId}×${codeOf.get(o.unitTypeId)} occ${o.occupancy}`;
      if (e.rate != null) {
        v.rateAll++; v.openAll++;
        if (c && Number(c.rate) === e.rate) v.rateOk++; else { v.rateMiss++; v.details.push(`${who}: ціна ${c?.rate ?? '?'} ≠ ${e.rate}`); }
        if (c && c.stop_sell === false) v.openOk++; else { v.openMiss++; v.details.push(`${who}: stop_sell=${c?.stop_sell ?? '?'}, мало бути false`); }
      } else {
        v.closedAll++;
        if (c && c.stop_sell === true) v.closedOk++; else v.details.push(`${who}: мало бути закрито, stop_sell=${c?.stop_sell ?? '?'}`);
      }
      v.availAll++;
      if (c && Number(c.availability) === e.availability) v.availOk++;
      else { v.availMiss++; v.details.push(`${who}: вільно ${c?.availability ?? '?'} ≠ ${e.availability}`); }
    }
    return v;
  }

  if (PROBE_429) {
    // ── 429 на живому: вендорські 10/хв на обʼєкт, обидві смуги ─────────
    //
    // Кожен прохід будує свій клієнт, тобто свій обмежувач: памʼяті між
    // проходами немає, і N проходів поспіль дають N справжніх викликів. Це
    // й потрібно, щоб побачити 429 ВЕНДОРА, а не відмову власного лімітера.
    //
    // Спершу смуга наявності (12 викликів проти документованих 10), потім,
    // якщо вендор промовчав, — смуга цін (15). Перша відмова зупиняє пробу.
    const u = unitTypes[0];
    const pair = pairs.find((p) => p.unitTypeId === u.localId) ?? pairs[0];
    const far = addDays(TO, 30);
    const lanes = [
      { kind: 'availability', n: 12, make: (date) => ({ kind: 'availability', unitTypeId: u.localId, date }) },
      { kind: 'rate', n: 15, make: (date) => ({ kind: 'rate', unitTypeId: pair.unitTypeId, ratePlanId: pair.localId, date }) },
    ];
    let hit = null;
    let total = 0;
    const started = Date.now();
    for (const lane of lanes) {
      console.log(`\nПРОБА 429, смуга ${lane.kind}: до ${lane.n} проходів по одній координаті (від ${far})`);
      for (let i = 1; i <= lane.n && !hit; i++) {
        const date = addDays(far, ++total);
        await enqueueChannelChange(sql, connectionId, lane.make(date));
        const r = await flushConnectionOutboxFor(connectionId);
        const err = r.errors.join(' | ');
        console.log(`  #${i} ${date}: sent ${r.sent}, failed ${r.failed}, calls ${r.calls}, +${((Date.now() - started) / 1000).toFixed(1)}s${err ? `  → ${err.slice(0, 160)}` : ''}`);
        if (r.failed > 0) hit = { lane: lane.kind, date, unitTypeId: u.localId, report: r };
      }
      if (hit) break;
    }
    if (!hit) {
      console.log(`\n  ${total} викликів за ${((Date.now() - started) / 1000).toFixed(0)} с на один обʼєкт — жодного 429.`);
      console.log('  Документований ліміт (10+10/хв на обʼєкт) на цьому середовищі не спрацював; питання 3');
      console.log('  лишається доведеним на моку (channex.check.ts, відповідь rateLimited) і в домені, не на живому.');
      process.exitCode = 1;
      return;
    }
    const queued = await queuedChannelChanges(connectionId);
    const back = queued.find((q) => q.date === hit.date);
    console.log(`\n  після відмови: у черзі ${queued.length}, застрягло ${(await stuckChannelChanges(connectionId)).length}`);
    console.log(`  координата ${hit.date}: ${back ? `ПОВЕРНУЛАСЬ, спроб ${back.attempts}, причина «${back.lastError}»` : 'НЕ В ЧЕРЗІ ← втрачена'}`);
    const is429 = /429/.test(String(back?.lastError ?? ''));
    console.log(`  3. 429 повернув координату в чергу: ${back && is429 ? '✓ так' : '✗ ні'}`);
    if (!back || !is429) process.exitCode = 1;

    console.log('\n  чекаю 65 с, щоб вікно вендора зрушило, і доганяю чергу…');
    await sleep(65_000);
    const r = await flushConnectionOutboxFor(connectionId);
    console.log(`  доганяючий прохід: sent ${r.sent}, failed ${r.failed}${r.errors.length ? `  → ${r.errors.join(' | ').slice(0, 160)}` : ''}`);
    const left = await pendingChannelChanges(connectionId);
    console.log(`  у черзі: ${left} (має бути 0 — нічого не лишаємо висіти)`);
    if (left > 0) process.exitCode = 1;
  }
});
