/**
 * Один прохід батчера ARI проти ЖИВОГО менеджера каналів — і читання назад.
 *
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId>                 # звіт: що поїхало б, що там зараз
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId> --confirm       # поставити в чергу, прогнати, прочитати назад
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId> --probe-429     # довести, що 429 повертає координату в чергу
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId> --retire <rpId> # зняти тариф з продажу дверима, прогнати, прочитати назад: закрито
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId> --restore <rpId># повернути в продаж, прогнати, прочитати назад: ціна знову
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId> --reprice <rpId>=<ціна>  # Блок 0.5: змінити ціну ТАРИФУ справжнім писачем, прогнати, прочитати назад — і показати, які поля були в тілі
 *   node scripts/channex-ari-live.mjs --org <orgId> <connId> --min-stay <rpId>=<n>    # 0072: мінімум ночей на ОДНОМУ тарифі, прочитати назад ОБИДВІ пари типу — сусідній тариф лишається зі своїм
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
 *
 * ── Блок 2.1: зняти з продажу — і побачити «закрито» на тому боці ───────
 *
 * `--retire <rpId>` кличе той самий писач, що й кнопка на екрані «Тарифи»
 * (`updateRatePlan` через `@pricing`): тариф стає `is_active = FALSE`, двері
 * кладуть координати на його пари до горизонту, прохід шле — і скрипт читає
 * календар вендора назад: кожна опція тарифу у вікні мусить бути
 * `stop_sell: true`. `--restore <rpId>` — назад: `stop_sell: false` і ціна.
 * Обидва — стан НАШОГО обʼєкта на staging (інваріант 25); після `--retire`
 * тариф лишається закритим, доки не зробити `--restore`.
 *
 * ── 0072: обмеження належить парі тип×тариф, не типу ────────────────────
 *
 * `--min-stay <rpId>=<n>` пише мінімум ночей ТИМ САМИМ писачем, що й
 * редактор дня з вимкненою галочкою «на всі тарифи типу» (`upsertPrices` з
 * `ratePlanId`): рядок пари отримує власне значення, координата йде лише на
 * цю пару. Читання назад — `min_stay_arrival` на КОЖНІЙ опції КОЖНОЇ пари
 * типу у вікні: опції названого тарифу мусять показати `n`, опції сусіднього
 * тарифу того ж типу — своє попереднє число. Одна пара довела б лише «щось
 * поїхало»; дві пари одного типу доводять, що поїхало на ту, а не на обидві
 * (тести 5/7/8 сертифікації). Значення лишається на нашому обʼєкті; повернути —
 * тим самим прапорцем з попереднім числом.
 */
import './lib/module-aliases.mjs';
import { sampleRecorder } from './lib/channex-samples.mjs';

const argv = process.argv.slice(2);
const PROBE_429 = argv.includes('--probe-429');
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
// Блок 2.1: зняти з продажу / повернути — це завжди прохід із читанням назад.
const FLIP = opt('--retire', null) ? { id: opt('--retire', null), active: false }
  : opt('--restore', null) ? { id: opt('--restore', null), active: true } : null;
// Блок 0.5: маска полів на живому. Ціна тарифу міняється ТИМ САМИМ писачем,
// що й масовий редактор (`bulkUpdatePrices` через `@pricing`): він сам ставить
// маску з різниці й кладе координату; прохід шле лише `rates`; читання назад
// — нова ціна; журнал `cm_sends` — які ключі були в тілі.
const REPRICE = (() => {
  const v = opt('--reprice', null);
  if (!v) return null;
  const [id, price] = v.split('=');
  if (!id || !(Number(price) > 0)) { console.error('--reprice чекає <rpId>=<ціна>, ціна > 0'); process.exit(2); }
  return { id, price: Number(price) };
})();
// 0072: мінімум ночей на одному тарифі — писачем редактора дня з `ratePlanId`,
// читання назад по ОБОХ парах типу (сусідня мусить лишитись незмінною).
const MIN_STAY = (() => {
  const v = opt('--min-stay', null);
  if (!v) return null;
  const [id, n] = v.split('=');
  if (!id || !Number.isInteger(Number(n)) || Number(n) < 1) { console.error('--min-stay чекає <rpId>=<n>, n — ціле ≥ 1'); process.exit(2); }
  return { id, n: Number(n) };
})();
const CONFIRM = argv.includes('--confirm') || !!FLIP || !!REPRICE || !!MIN_STAY;

let organizationId = null;
let connectionId = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--org') { organizationId = argv[++i]; continue; }
  if (['--from', '--days', '--retire', '--restore', '--reprice', '--min-stay'].includes(argv[i])) { i++; continue; }
  if (argv[i].startsWith('--')) continue;
  connectionId = argv[i];
}
if (!organizationId || !connectionId) {
  console.error('usage: node scripts/channex-ari-live.mjs --org <orgId> <connId> [--confirm|--probe-429|--retire <rpId>|--restore <rpId>|--reprice <rpId>=<ціна>|--min-stay <rpId>=<n>] [--from YYYY-MM-DD] [--days N]');
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
  enqueueChannelChange, pendingChannelChanges, queuedChannelChanges, stuckChannelChanges, recentChannelSends,
  recentChannelSendLog, verifyConnectionSendsFor } = await import('@channels');
// Інваріант 28: кожна жива відповідь лягає зразком у docs/vendor/channex/live/.
const { recordVendorResponses } = await import('@channels');
recordVendorResponses(sampleRecorder());
const { availabilityByDay, catalogUnitTypes } = await import('@properties');
const { priceNights, updateRatePlan, listRatePlans, bulkUpdatePrices, upsertPrices } = await import('@pricing');

/** Сире читання повз наш клієнт: звірка мусить бачити відповідь, а не наше тлумачення. */
async function get(path) {
  const res = await fetch(BASE + path, { headers: { 'user-api-key': apiKey } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** `data[optionId][date] = { rate, stop_sell, availability, min_stay_arrival }` — И13; мінімум читається тим самим імʼям, яким шлеться (INC-015). */
async function readCalendar(remotePropertyId, from, to) {
  const body = await get(`/restrictions?filter[property_id]=${remotePropertyId}`
    + `&filter[date][gte]=${from}&filter[date][lte]=${to}&filter[restrictions]=rate,stop_sell,availability,min_stay_arrival`);
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

  // ── Блок 2.1: зняти з продажу / повернути — ДВЕРИМА, до очікувань ──────
  // Очікування нижче рахуються вже для нового стану: `priceNights` віддає
  // ночі знятого тарифу як `missing`, тобто «закрито», — рівно те, що має
  // побачити читання назад.
  if (FLIP) {
    const plan = (await listRatePlans(connection.propertyId)).find((p) => p.id === FLIP.id);
    if (!plan) { console.error(`✗ тариф ${FLIP.id} не на обʼєкті цього зʼєднання`); process.exitCode = 1; return; }
    if (!pairs.some((p) => p.localId === plan.id)) { console.error(`✗ тариф ${plan.code} не заведено у вендора — нема чого закривати`); process.exitCode = 1; return; }
    console.log(`\nТАРИФ ${plan.code} (${plan.id}): ${plan.isActive ? 'продається' : 'знято з продажу'} → ${FLIP.active ? 'ПОВЕРНУТИ В ПРОДАЖ' : 'ЗНЯТИ З ПРОДАЖУ'}`);
    const flipped = await updateRatePlan(plan.id, { isActive: FLIP.active });
    console.log(`  писач: isActive=${flipped.isActive}; у черзі ціни ${await pendingChannelChanges(connectionId, 'rate')} (координати до горизонту від дверей, Ц16)`);
  }

  // ── Блок 0.5: ціна тарифу — справжнім писачем, до очікувань ────────────
  if (REPRICE) {
    const plan = (await listRatePlans(connection.propertyId)).find((p) => p.id === REPRICE.id);
    if (!plan) { console.error(`✗ тариф ${REPRICE.id} не на обʼєкті цього зʼєднання`); process.exitCode = 1; return; }
    const own = pairs.filter((p) => p.localId === plan.id);
    if (!own.length) { console.error(`✗ тариф ${plan.code} не заведено у вендора`); process.exitCode = 1; return; }
    console.log(`\nТАРИФ ${plan.code}: ціна ${REPRICE.price} на ${FROM}…${TO} — писачем масового редактора, на кожному типі пари`);
    for (const p of own) {
      await bulkUpdatePrices({ unitTypeId: p.unitTypeId, dateFrom: FROM, dateTo: TO, applyTo: 'all', base_price: REPRICE.price, ratePlanId: plan.id });
    }
    const queued = (await queuedChannelChanges(connectionId)).filter((q) => q.kind === 'rate' && q.date === FROM);
    console.log(`  у черзі від писача: ${queued.length} координат, маски: ${[...new Set(queued.map((q) => JSON.stringify(q.fields)))].join(' ')}`);
  }

  // ── 0072: мінімум ночей на одній парі — писачем редактора дня, до очікувань ──
  let minStayBefore = null; // optionRemoteId|date → min_stay_arrival до запису, для сусідніх пар
  if (MIN_STAY) {
    const plan = (await listRatePlans(connection.propertyId)).find((p) => p.id === MIN_STAY.id);
    if (!plan) { console.error(`✗ тариф ${MIN_STAY.id} не на обʼєкті цього зʼєднання`); process.exitCode = 1; return; }
    const own = pairs.filter((p) => p.localId === plan.id);
    if (!own.length) { console.error(`✗ тариф ${plan.code} не заведено у вендора`); process.exitCode = 1; return; }
    const siblings = pairs.filter((p) => p.localId !== plan.id && own.some((o) => o.unitTypeId === p.unitTypeId));
    if (!siblings.length) {
      console.error(`✗ на типах тарифу ${plan.code} немає другого тарифу — одна пара не доводить, що обмеження лягло на тариф, а не на тип`);
      process.exitCode = 1; return;
    }
    minStayBefore = await readCalendar(remote, FROM, TO);
    console.log(`\nТАРИФ ${plan.code}: мінімум ${MIN_STAY.n} ночей на ${FROM}…${TO} — писачем редактора дня з ratePlanId (галочка «на всі тарифи типу» ВИМКНЕНА), на кожному типі пари`);
    for (const p of own) {
      await upsertPrices(p.unitTypeId, DATES.map((date) => ({ date, min_stay: MIN_STAY.n })), { ratePlanId: plan.id });
    }
    const queued = (await queuedChannelChanges(connectionId)).filter((q) => q.kind === 'rate' && q.date === FROM);
    const onSiblings = queued.filter((q) => siblings.some((s) => s.unitTypeId === q.unitTypeId && s.localId === q.ratePlanId));
    console.log(`  у черзі від писача: ${queued.length} координат, маски: ${[...new Set(queued.map((q) => JSON.stringify(q.fields)))].join(' ')}`
      + `; на сусідніх парах типу: ${onSiblings.length}${onSiblings.length ? '   ← координата пішла на чужий тариф' : ''}`);
    if (onSiblings.length) process.exitCode = 1;
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
    // З --reprice координати вже поклав справжній писач — зі своєю маскою;
    // класти повні поверх означало б стерти маску (NULL поглинає) і довести
    // не те, що питаємо.
    if (!REPRICE && !MIN_STAY) {
      for (const u of unitTypes) {
        await enqueueChannelChange(sql, connectionId, { kind: 'availability', unitTypeId: u.localId, date: FROM, dateTo: TO });
      }
      for (const p of pairs) {
        await enqueueChannelChange(sql, connectionId, { kind: 'rate', unitTypeId: p.unitTypeId, ratePlanId: p.localId, date: FROM, dateTo: TO });
      }
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
    // З --min-stay чекати треба й на САМ мінімум: ціни в цьому проході не
    // мінялися, тож збіг за цінами настав би на першій же спробі — і читання
    // назад побачило б старе число, якого вендор ще не встиг замінити.
    const minStayReady = (cal) => !MIN_STAY || options
      .filter((o) => o.localId === MIN_STAY.id)
      .every((o) => DATES.every((date) => cal[o.remoteId]?.[date]?.min_stay_arrival === MIN_STAY.n));
    let after = null;
    let verdict = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(attempt === 0 ? 1500 : 2500);
      after = await readCalendar(remote, FROM, TO);
      verdict = compare(after);
      if (verdict.rateMiss === 0 && verdict.openMiss === 0 && verdict.availMiss === 0 && minStayReady(after)) break;
    }
    show(after, 'ПІСЛЯ (живий календар вендора)');

    // Блок 2.1: читання назад для знятого/повернутого тарифу — кожна його
    // опція у вікні. Не «код відповіді 200», а значення в чужому календарі
    // (інваріант 27).
    if (FLIP) {
      const own = options.filter((o) => o.localId === FLIP.id);
      let bad = 0;
      for (const o of own) {
        for (const date of DATES) {
          const c = after[o.remoteId]?.[date];
          const ok = FLIP.active ? (c && c.stop_sell === false && c.rate != null) : (c && c.stop_sell === true);
          if (!ok) { bad++; console.log(`  ! ${date} ${o.localId}×${codeOf.get(o.unitTypeId)} occ${o.occupancy}: ${JSON.stringify(c ?? null)}`); }
        }
      }
      const total = own.length * DATES.length;
      console.log(`\nБЛОК 2.1 — ${FLIP.active ? 'ПОВЕРНУТО В ПРОДАЖ' : 'ЗНЯТО З ПРОДАЖУ'}: ${total - bad} з ${total} ночей опцій тарифу `
        + `${FLIP.active ? 'відкриті з ціною' : 'закриті (stop_sell)'} у ЖИВОМУ календарі вендора${bad ? '   ← НЕ ЗІЙШЛОСЯ' : ''}`);
      if (bad) process.exitCode = 1;
    }
    // П6: розписки вендора на відправлених координатах — те, що йде у форму.
    // Судяться лише рядки ЦЬОГО проходу (найновіші `report.sent`): відправлене
    // до появи колонки розписки не має і мати не може.
    const sent = await recentChannelSends(connectionId, Math.max(10, report.sent));
    const thisPass = sent.slice(0, report.sent);
    console.log(`\nРОЗПИСКИ (цей прохід ${thisPass.length}): ${thisPass.filter((r) => r.receipt).length} з розпискою`);
    for (const r of sent.slice(0, 6)) console.log(`  ${String(r.sentAt).slice(0, 19)} ${r.kind} ${r.date}${r.dateTo ? '–' + r.dateTo : ''} → ${r.receipt ?? '—'}`);
    if (thisPass.some((r) => !r.receipt)) { console.log('  ! відправлене без розписки — задачу вендора нема чим назвати'); process.exitCode = 1; }

    // Блок 0.5 п.4: журнал відправлень — ЯКІ ПОЛЯ були в тілі кожного виклику.
    // Це те, що контролер звіряє з таблицею тесту до подання форми.
    const log = (await recentChannelSendLog(connectionId, Math.max(4, report.calls))).slice(0, report.calls);
    console.log(`\nЖУРНАЛ ВІДПРАВЛЕНЬ (цей прохід, ${log.length} виклик(ів)):`);
    for (const l of log) {
      console.log(`  ${String(l.sentAt).slice(0, 19)} ${l.lane.padEnd(12)} ${l.responseStatus ?? '—'} task ${l.taskId ?? '—'}  значень ${l.rowsCount}  поля: ${l.summary.fields.join(', ')}  ${l.summary.from}…${l.summary.to}`);
    }
    // 0072: читання назад по ОБОХ парах кожного типу — названий тариф показує n,
    // сусідній — своє попереднє число. Не «код 200», а значення (інваріант 27).
    if (MIN_STAY) {
      const own = options.filter((o) => o.localId === MIN_STAY.id);
      const ownTypes = new Set(own.map((o) => o.unitTypeId));
      const neighbours = options.filter((o) => o.localId !== MIN_STAY.id && ownTypes.has(o.unitTypeId));
      let bad = 0;
      console.log(`\n0072 — МІНІМУМ НОЧЕЙ НА ТАРИФІ (читання назад, ${FROM}…${TO}):`);
      for (const o of [...own, ...neighbours]) {
        for (const date of DATES) {
          const got = after[o.remoteId]?.[date]?.min_stay_arrival;
          // Сусід міг не мати рядка взагалі — тоді «без змін» це та сама
          // відсутність, а не число; порівнюємо як є, включно з обома порожніми.
          const want = o.localId === MIN_STAY.id ? MIN_STAY.n : minStayBefore[o.remoteId]?.[date]?.min_stay_arrival;
          const ok = got === want;
          if (!ok) bad++;
          console.log(`  ${ok ? ' ' : '!'} ${date} ${o.localId}×${codeOf.get(o.unitTypeId)} occ${o.occupancy}: min_stay_arrival=${got ?? '?'} (${o.localId === MIN_STAY.id ? 'мало стати' : 'мало лишитись'} ${want ?? '?'})`);
        }
      }
      const total = (own.length + neighbours.length) * DATES.length;
      console.log(`  ${total - bad} з ${total} ночей опцій зійшлись: тариф ${MIN_STAY.id} = ${MIN_STAY.n}, сусідні тарифи тих самих типів — без змін${bad ? '   ← НЕ ЗІЙШЛОСЯ' : ''}`);
      const rateCalls = log.filter((l) => l.lane === 'rate');
      const touchedForeign = rateCalls.some((l) => (l.summary.pairs ?? []).some((pr) => pr.ratePlanId !== MIN_STAY.id));
      if (touchedForeign) console.log('  ! у тілі проходу були координати чужого тарифу');
      if (bad || touchedForeign) process.exitCode = 1;
    }
    if (REPRICE) {
      const rateCalls = log.filter((l) => l.lane === 'rate');
      const onlyRates = rateCalls.length > 0 && rateCalls.every((l) => l.summary.fields.join(',') === 'rates');
      console.log(`\nБЛОК 0.5 — МАСКА: ${onlyRates ? '✓' : '✗'} зміна ціни тарифу поїхала лише полем rates${onlyRates ? '' : ' — у тілі є зайві поля (Б1 листа Channex)'}`);
      if (!onlyRates) process.exitCode = 1;
    }

    // П6 частина 2: звірка ДВЕРИМА модуля — те саме, що робить кнопка «Звірити
    // з каналом». Без вікна застосування: прохід вище вже дочекався збігу сам.
    // Читання йде через клієнт, тож зразок `GET /restrictions` лягає в
    // docs/vendor/channex/live/ (інваріант 28); сира звірка вище лишається —
    // вона бачить відповідь, а не наше тлумачення.
    const showVerification = (v, label) => {
      const unverified = v.unverified.map((u) => `${u.field}×${u.count}`).join(', ') || '—';
      console.log(`\n${label} (${v.window ? `${v.window.from}…${v.window.to}` : 'нема чого'}): порівняно ${v.checked}, `
        + `збігається ${v.matched}, розбіжностей ${v.mismatches.length}, повернуто в чергу ${v.requeued}, не звірено ${unverified}`);
      for (const m of v.mismatches.slice(0, 8)) {
        console.log(`  ! ${m.date} ${m.ratePlanId ?? ''}×${codeOf.get(m.unitTypeId) ?? m.unitTypeId} occ${m.occupancy ?? '-'} ${m.field}: ${m.ours} ≠ ${m.theirs}`);
      }
    };
    const inPass = (m) => m.date >= FROM && m.date <= TO;
    let v = await verifyConnectionSendsFor(connectionId, { minAgeSeconds: 0 });
    showVerification(v, 'ЗВІРКА ДВЕРИМА');
    // Вікно ЦЬОГО проходу мусить збігтись — сира звірка вище щойно це бачила.
    if (v.checked === 0 || v.mismatches.some(inPass)) { console.log('  ! звірка дверима розійшлась із сирою у вікні проходу'); process.exitCode = 1; }
    // Поза вікном — дрейф давніших відправлень (проба 429 слала на місяць
    // уперед, зсув і ціни відтоді змінились). Це не провал проходу, а те, для
    // чого звірка існує: координати вже повернуто в чергу — доганяємо їх ще
    // одним проходом і перезвіряємо. Коло має замкнутись: розбіжність → черга
    // → відправлення → збіг.
    // Два кола, не одне: нуль наявності на тому боці панує над прапорцем
    // (живе 02.09.2026), тож перше коло везе наявність, друге — прапорець.
    for (let round = 1; v.requeued > 0 && round <= 2; round++) {
      const again = await flushConnectionOutboxFor(connectionId);
      console.log(`\nДОГАНЯЮЧИЙ ПРОХІД ${round}: відправлено ${again.sent}, повернуто ${again.failed}, викликів ${again.calls}${again.errors.length ? `  → ${again.errors.join(' | ').slice(0, 160)}` : ''}`);
      for (let attempt = 0; attempt < 12; attempt++) {
        await sleep(attempt === 0 ? 1500 : 2500);
        v = await verifyConnectionSendsFor(connectionId, { minAgeSeconds: 0 });
        if (v.mismatches.length === 0) break;
      }
      showVerification(v, `ПЕРЕЗВІРКА ${round}`);
      if (v.mismatches.length === 0 && v.requeued === 0) { console.log('  ✓ коло замкнулось: розбіжність → черга → відправлення → збіг'); break; }
      if (round === 2) { console.log('  ! коло не замкнулось: після двох доганяючих проходів лишились розбіжності'); process.exitCode = 1; }
    }
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
