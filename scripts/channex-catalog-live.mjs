/**
 * Завести каталог у ЖИВОМУ менеджері каналів і звірити, що заведено саме те.
 *
 *   node scripts/channex-catalog-live.mjs <connectionId> [<connectionId>…]
 *   node scripts/channex-catalog-live.mjs <connectionId> --confirm
 *   node scripts/channex-catalog-live.mjs <connectionId> --verify-only
 *
 * ── Навіщо це скрипт, а не маршрут ──────────────────────────────────────
 *
 * `syncConnectionCatalog()` не має викликача, і це свідомо: маршрут, який
 * створює сутності в ЧУЖОМУ акаунті, зʼявиться разом із майстром підключення
 * і власною вартою, а не «щоб не висіло». Але прогнати його проти живого
 * staging треба ЗАРАЗ — інакше приймання §10.10 лишається доведеним на
 * стенді в памʼяті. Скрипт — це те, що можна запустити, не відкриваючи
 * жодної кнопки нікому.
 *
 * За тією ж причиною ім'я вендора тут написане прямо: гейт
 * `check-vendor-isolation` сканує `src/`, і шов композиції (`providers.ts`,
 * рішення Р10) існує для застосунку, а не для інструментів оператора.
 * Заводити в ньому фабрику каталогу ДО того, як зʼявиться майстер, означало б
 * ухвалити за майстра, як він буде влаштований.
 *
 * ── Дефолт нічого не створює ────────────────────────────────────────────
 *
 * Без `--confirm` це звіт: що ми послали б і що вже є на тому боці. Створення
 * в чужому акаунті — дія, яку не можна відкотити однією командою, тож вона
 * вимагає слова вголос. `--verify-only` пропускає створення і лише звіряє
 * дзеркало з тим, що віддає API.
 *
 * ── Що саме доводиться ──────────────────────────────────────────────────
 *
 * Не «підключилось». Приймання §10.10: ДРУГИЙ обʼєкт з іншим набором тарифів
 * і іншим вибором типів номерів проходить ТИМ САМИМ кодом. Тому скрипт
 * бере кілька зʼєднань за раз і наприкінці каже це окремим рядком: один
 * обʼєкт не доводить нічого, бо з ним усе зламане виглядає цілим (той самий
 * довід, що в `check-isolation.mjs` про дві організації).
 *
 * ── Пастка в назві `/rate_plans/options` ────────────────────────────────
 *
 * Звірка читає ДВА ендпоінти, і це не надмірність.
 *
 * `GET /rate_plans/options` — попри назву, це НЕ список заселеностей. Дослівно
 * з документації: «list of all RATE PLANS associated with the current account
 * without additional details and pagination limits». Тобто «options» тут — це
 * «варіанти у списку вибору», по рядку на ТАРИФ. Зате кожен рядок несе
 * `room_type_id`, тобто саме вісь ПАРИ, заради якої існує
 * `cm_mappings.unit_type_id` (Ц10) — у списковому `GET /rate_plans` цього поля
 * немає взагалі.
 *
 * Опції заселеності — ті, чиїми ідентифікаторами індексований календар (И13)
 * і які лежать у дзеркалі як `rate_plan_option`, — живуть у `options[]`
 * всередині `GET /rate_plans`. Прочитати їх з `/rate_plans/options` не можна.
 *
 * Це не дрібниця: звірка, яка порівняє наші 7 опцій із їхніми 3 тарифами,
 * оголосить РОЗБІЖНІСТЬ там, де обидві сторони праві. Так і сталося на
 * першому прогоні 01.09.2026.
 *
 * `filter[property_id]` обовʼязковий в обох — без нього ендпоінт віддає
 * тарифи ВСІХ обʼєктів акаунта, тобто чужих орендарів (межа И11).
 */
// Аліаси `@core/…` і розрив `next/*` — спільним завантажувачем. Власної копії
// тут не треба: цей скрипт запускають усередині репозиторію, а не на сервері
// під час деплою (саме тому свою копію тримає apply-hotel.mjs, і лише він).
import './lib/module-aliases.mjs';
import { sampleRecorder } from './lib/channex-samples.mjs';

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
const VERIFY_ONLY = argv.includes('--verify-only');
// `--org X conn… --org Y conn…` — орендар діє на все, що йде за ним. Двох
// готелів у ОДНОМУ прогоні вимагає саме приймання §10.10: вони майже завжди
// різні організації, а вердикт «інша форма пройшла тим самим кодом» має
// сенс лише коли обидві форми пройшли поруч.
const jobs = [];
{
  let current = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--org') { current = argv[++i]; continue; }
    if (argv[i].startsWith('--')) continue;
    if (current) jobs.push({ organizationId: current, connectionId: argv[i] });
  }
}

if (jobs.length === 0) {
  console.error('usage: node scripts/channex-catalog-live.mjs --org <orgId> <connId>… [--org <orgId> <connId>…] [--confirm|--verify-only]');
  console.error('');
  console.error('  --org обовʼязковий і це не незручність: зʼєднання читаються');
  console.error('  ЧЕРЕЗ орендаря (connectionInTenant), а не за самим лише id.');
  console.error('  Пошук «чиє це зʼєднання» повз орендаря — саме той запит, від');
  console.error('  якого застерігає INC-010; інструмент оператора не має бути');
  console.error('  єдиним місцем, де так можна.');
  process.exit(2);
}

const apiKey = process.env.CHANNEX_API_KEY;
if (!apiKey) {
  console.error('немає CHANNEX_API_KEY в оточенні — далі йти нема куди');
  process.exit(2);
}
const environment = process.env.CHANNEX_ENV === 'production' ? 'production' : 'staging';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { syncConnectionCatalogFor, channelConnection, connectionMirror } = await import('@channels');
// Інваріант 28: кожна жива відповідь лягає зразком у docs/vendor/channex/live/.
const { recordVendorResponses } = await import('@channels');
recordVendorResponses(sampleRecorder());
const { catalogProperty, catalogUnitTypes } = await import('@properties');
const { propertyRatePlans } = await import('@pricing');

const BASE = environment === 'production'
  ? 'https://app.channex.io/api/v1' : 'https://staging.channex.io/api/v1';

/** Читання повз наш клієнт: звірка мусить бачити сире, а не наше тлумачення. */
async function get(path) {
  const res = await fetch(BASE + path, { headers: { 'user-api-key': apiKey } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** ТАРИФИ (не заселеності!) з `room_type_id` — вісь пари. Див. шапку. */
async function readRatePlans(remotePropertyId) {
  const body = await get(`/rate_plans/options?filter[property_id]=${remotePropertyId}`);
  return (body.data ?? []).map((row) => ({
    id: row.attributes?.id ?? row.id,
    title: row.attributes?.title,
    unitTypeRemoteId: row.attributes?.room_type_id,
  }));
}

/**
 * Канали обʼєкта разом із мапінг-айтемами — джерело звірки «створене змаплене».
 *
 * `attributes.rate_plans` — це `{id, rate_plan_id, settings}`, і схема каже
 * прямо: «Empty while the connection is unmapped». `is_active` теж читаємо:
 * «Disabled connections do not send updates to the channel», тобто тариф,
 * змаплений лише на вимкнене зʼєднання, продається так само нікуди.
 */
async function readChannels(remotePropertyId) {
  const body = await get(`/channels?filter[property_id]=${remotePropertyId}`);
  return (body.data ?? []).map((row) => ({
    id: row.id,
    title: row.attributes?.title,
    channel: row.attributes?.channel,
    isActive: !!row.attributes?.is_active,
    ratePlanIds: (row.attributes?.rate_plans ?? []).map((m) => String(m.rate_plan_id)),
  }));
}

/** ОПЦІЇ ЗАСЕЛЕНОСТІ — ті, якими індексований календар (И13). */
async function readOccupancyOptions(remotePropertyId) {
  const body = await get(`/rate_plans?filter[property_id]=${remotePropertyId}`);
  const out = [];
  for (const plan of body.data ?? []) {
    for (const o of plan.attributes?.options ?? []) {
      out.push({
        id: String(o.id), occupancy: Number(o.occupancy),
        title: plan.attributes?.title, isPrimary: !!o.is_primary,
      });
    }
  }
  return out;
}

const results = [];

for (const { organizationId, connectionId } of jobs) {
  await runWithOrganization(organizationId, async () => {
    // Чуже й неіснуюче однаково дають null — 404, не 403 (інваріант 5).
    const connection = await channelConnection(connectionId);
    if (!connection) {
      console.error(`\n✗ зʼєднання ${connectionId} не наше або не існує`);
      results.push({ connectionId, ok: false, why: 'зʼєднання не знайдено в цьому орендарі' });
      return;
    }
    const propertyId = connection.propertyId;

    console.log(`\n${'═'.repeat(74)}`);
    console.log(`ЗʼЄДНАННЯ ${connectionId}  (обʼєкт ${propertyId}, ${environment})`);
    console.log('═'.repeat(74));

    const property = await catalogProperty(propertyId);
    const unitTypes = await catalogUnitTypes(propertyId);
    const plans = await propertyRatePlans(propertyId);

    // Скільки ПАР вийде — це і є те, що множиться проти стелі вендора.
    //
    // Очікування мусить повторювати правило домену, а не рахувати наївно:
    // тип без жодного номера туди не їде (`count_of_rooms > 0` — вимога того
    // боку), тож пара на ньому не зʼявиться. Порахувати її означало б
    // оголосити розбіжністю правильну поведінку.
    const withRooms = new Set(unitTypes.filter((u) => u.roomCount > 0).map((u) => u.id));
    const pairsAll = plans.reduce((n, p) => n + (p.sellable ? p.unitTypes.length : 0), 0);
    const pairs = plans.reduce(
      (n, p) => n + (p.sellable ? p.unitTypes.filter((u) => withRooms.has(u.id)).length : 0), 0);
    console.log(`\nНАШ БІК: "${property?.title}"`);
    console.log(`  типів номерів: ${unitTypes.length} (${unitTypes.map((u) => `${u.code}×${u.roomCount}`).join(', ')})`);
    console.log(`  тарифів:       ${plans.length}, продаваних ${plans.filter((p) => p.sellable).length}`);
    for (const p of plans) {
      const on = p.sellable ? p.unitTypes.map((u) => `${u.code}[${u.occupancies.join(',')}]`).join(' ') : '—';
      console.log(`    ${p.code.padEnd(8)} ${p.sellable ? '' : '(без ціни, не поїде) '}${on}`);
    }
    console.log(`  ПАР «тип × тариф» = тарифів у менеджера каналів: ${pairs}`
      + (pairsAll !== pairs ? `  (${pairsAll - pairs} на типах без номерів не поїде)` : ''));

    if (!CONFIRM && !VERIFY_ONLY) {
      console.log('\n  (це звіт: без --confirm нічого не створюється)');
      results.push({ connectionId, ok: true, dryRun: true, pairs });
      return;
    }

    let report = null;
    if (!VERIFY_ONLY) {
      report = await syncConnectionCatalogFor(connectionId);
      console.log('\nЗАВЕДЕНО:');
      console.log(`  обʼєкт на тому боці: ${report.remotePropertyId}`);
      console.log(`  створено: типів ${report.created.unitTypes}, тарифів ${report.created.ratePlans}, опцій ${report.created.options}`);
      console.log(`  вже було: типів ${report.existing.unitTypes}, тарифів ${report.existing.ratePlans}`);
      for (const s of report.skipped) console.log(`  пропущено ${s.what} ${s.localId}: ${s.reason}`);
    }

    const fresh = await channelConnection(connectionId);
    const remotePropertyId = report?.remotePropertyId ?? fresh?.remotePropertyId;
    if (!remotePropertyId) {
      console.log('\n  обʼєкт ще не заведено — звіряти нема з чим');
      results.push({ connectionId, ok: false, why: 'обʼєкт не заведено' });
      return;
    }

    // ── Звірка: наше дзеркало проти того, що віддає API ─────────────────
    const remotePlans = await readRatePlans(remotePropertyId);
    const remoteOptions = await readOccupancyOptions(remotePropertyId);
    const mirror = await connectionMirror(connectionId);
    const mirrorPlans = mirror.filter((m) => m.entityType === 'rate_plan');
    const mirrorOptions = mirror.filter((m) => m.entityType === 'rate_plan_option');
    const mirrorUnitTypes = mirror.filter((m) => m.entityType === 'unit_type');

    const cmp = (mine, theirs, label) => {
      const theirIds = new Set(theirs.map((t) => t.id));
      const lost = mine.filter((m) => !theirIds.has(m.remoteId));
      const extra = theirs.filter((t) => !mine.some((m) => m.remoteId === t.id));
      console.log(`  ${label}: у нас ${mine.length}, у них ${theirs.length}`
        + `  |  у дзеркалі є, у них нема: ${lost.length}`
        + `  |  у них є, у дзеркалі нема: ${extra.length}`);
      if (lost.length) console.log(`      втрачені: ${lost.map((m) => m.remoteId).join(', ')}`);
      if (extra.length) console.log(`      зайві:    ${extra.map((t) => `${t.title}/occ${t.occupancy ?? '—'}`).join(', ')}`);
      return lost.length === 0 && extra.length === 0;
    };

    console.log('\nЗВІРКА (два ендпоінти — див. шапку файла):');
    const plansOk = cmp(mirrorPlans, remotePlans, 'тарифи   /rate_plans/options');
    const optsOk = cmp(mirrorOptions, remoteOptions, 'заселен. /rate_plans→options[]');

    // Вісь ПАРИ (Ц10): наш тариф на N типах — це N їхніх тарифів, і кожен
    // їхній мусить сидіти на СВОЄМУ типі номера. Перевіряється лише тут:
    // у списковому /rate_plans поля room_type_id немає.
    const unitTypeRemote = new Map(mirrorUnitTypes.map((m) => [m.localId, m.remoteId]));
    const pairKeys = new Set(mirrorPlans.map((m) => `${m.localId}|${m.unitTypeId}`));
    const misplaced = mirrorPlans.filter((m) => {
      const theirs = remotePlans.find((t) => t.id === m.remoteId);
      return theirs && theirs.unitTypeRemoteId !== unitTypeRemote.get(m.unitTypeId);
    });
    console.log(`  вісь пари: ${pairKeys.size} пар (очікувано ${pairs}),`
      + ` тарифів не на своєму типі: ${misplaced.length}`);

    // ── Ц8: створене — ще не проданe. Звірка «створене змаплене» ────────
    //
    // `POST /api/v1/channels` ми не викликаємо (§4.3 віддав екран каналів в
    // iFrame), тож змапити наш тариф на конкретний OTA може лише готельєр.
    // Якщо він цього не зробить, ПОМИЛКИ НЕ БУДЕ НІ З ЧИЙОГО БОКУ: у них усе
    // правильно, у нас усе створено, а тариф просто ніде не продається.
    // Тому це не гейт збірки (відповідь залежить від живого API), а
    // попередження з переліком.
    const channels = await readChannels(remotePropertyId);
    const mappedAnywhere = new Set(channels.flatMap((c) => c.ratePlanIds));
    const mappedActive = new Set(channels.filter((c) => c.isActive).flatMap((c) => c.ratePlanIds));
    const unmapped = mirrorPlans.filter((m) => !mappedAnywhere.has(m.remoteId));
    const onlyInactive = mirrorPlans.filter(
      (m) => mappedAnywhere.has(m.remoteId) && !mappedActive.has(m.remoteId));

    console.log('\nСТВОРЕНЕ ЗМАПЛЕНЕ? (Ц8 — це робить готельєр в iFrame, не ми):');
    if (channels.length === 0) {
      console.log('  каналів у обʼєкта: 0 — жоден тариф нікуди не продається');
    } else {
      for (const c of channels) {
        console.log(`  ${c.isActive ? '●' : '○'} ${c.channel} "${c.title}": змаплено тарифів ${c.ratePlanIds.length}`);
      }
    }
    if (unmapped.length) {
      console.log(`  ⚠ НЕ ЗМАПЛЕНО ЖОДНОГО КАНАЛУ: ${unmapped.length} з ${mirrorPlans.length}`);
      for (const m of unmapped) console.log(`      ${m.localId} на типі ${m.unitTypeId} → ${m.remoteId}`);
    }
    if (onlyInactive.length) {
      console.log(`  ⚠ змаплено лише на ВИМКНЕНІ зʼєднання: ${onlyInactive.length}`);
    }
    if (!unmapped.length && !onlyInactive.length && channels.length) {
      console.log('  ✓ кожен створений тариф змаплений хоча б на один увімкнений канал');
    }

    const ok = plansOk && optsOk && pairKeys.size === pairs && misplaced.length === 0;
    console.log(`\n  ${ok ? '✓ сходиться' : '✗ РОЗБІЖНІСТЬ'}`);
    results.push({
      connectionId, ok, pairs, title: property?.title,
      unmapped: unmapped.length, channels: channels.length,
      // Підпис форми: саме він доводить, що другий обʼєкт справді ІНШИЙ.
      shape: `${unitTypes.length}т/${plans.filter((p) => p.sellable).length}тар/${pairs}пар/${mirrorOptions.length}засел/${plans[0]?.currency ?? '—'}`,
    });
  });
}

// ── Приймання §10.10 ──────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(74)}`);
const done = results.filter((r) => !r.dryRun);
if (done.length < 2) {
  console.log('ПРИЙМАННЯ: не доведене — один обʼєкт не доводить нічого.');
  console.log('Потрібні ДВА зʼєднання з різними наборами тарифів: на одному');
  console.log('обʼєкті все зламане виглядає цілим (той самий довід, що в');
  console.log('check-isolation.mjs про дві організації).');
} else {
  const allOk = done.every((r) => r.ok);
  // Підпис форми, а не одне число: два обʼєкти можуть випадково зійтися в
  // кількості пар і при цьому мати різні типи, тарифи, заселеності й валюту.
  // Порівняння за одним числом оголосило б їх однаковими — і тест, який мав
  // доводити «інша форма проходить тим самим кодом», не доводив би нічого.
  const distinct = new Set(done.map((r) => r.shape)).size === done.length;
  console.log('ПРИЙМАННЯ §10.10 — другий обʼєкт іншої форми тим самим кодом:');
  for (const r of done) console.log(`  ${r.title}: ${r.shape}${r.ok ? '' : '   ← розбіжність'}`);
  console.log(`  форми справді різні: ${distinct ? 'так' : 'НІ — тест нічого не доводить'}`);
  console.log(`  обидва зійшлися:     ${allOk ? 'так' : 'НІ'}`);
  console.log(`\n  ${allOk && distinct ? '✓ ПРИЙНЯТО' : '✗ НЕ ПРИЙНЯТО'}`);
  if (!allOk || !distinct) process.exitCode = 1;
}
