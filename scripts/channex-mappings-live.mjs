/**
 * Дзеркало мапінгу проти ЖИВОГО каталогу вендора: зайве, відсутнє, розбіжне.
 *
 *   node scripts/channex-mappings-live.mjs --org <orgId> <connId>        # дзеркало ↔ вендор
 *   node scripts/channex-mappings-live.mjs --remote <remotePropertyId>   # лише бік вендора, без бази
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * Лист Channex від 05.09.2026 (Б3): у тілі тесту 3 був тариф, якого таблиця
 * тесту не називала, — `505e5d24…`. Код дає два шляхи до «зайвого» тарифу в
 * тілі: пара з рядка `price_calendar` без ціни (закрито з 05.09 — рядок з
 * `base_price NULL` пари не робить) і правка БАЗОВОЇ ціни типу, яка
 * розсилається на кожну пару типу, включно з парою сусіднього тарифу. Який з
 * них — видно лише поруч із живим каталогом: цей скрипт ставить дзеркало
 * (`cm_mappings`) і `GET /rate_plans` вендора в одну таблицю і називає
 * кожен рядок: **зайве** (у вендора є, у дзеркалі нема), **відсутнє** (у
 * дзеркалі є, у вендора нема), **розбіжне** (той самий id, інший тип
 * номера). Читання й нічого більше (інваріант 25): жодного `PUT`, `DELETE`
 * чи `ack` — прибирати зайве в панелі вендора вирішує людина.
 *
 * `--remote` без бази — для середовища, де ключ є, а бази зʼєднання немає
 * (сесія розробки): друкує лише те, що віддає вендор, і цього досить, щоб
 * сказати, ЧИЙ тариф `505e5d24…`.
 *
 * ── Два ендпоінти, і це не надмірність ──────────────────────────────────
 *
 * `GET /rate_plans/options` — попри назву, це список ТАРИФІВ з `room_type_id`
 * (вісь пари, Ц10), а не заселеностей; `GET /rate_plans` несе `options[]` —
 * опції заселеності з власними id, якими індексований календар (И13).
 * `filter[property_id]` обовʼязковий в обох: без нього ендпоінт віддає
 * тарифи всіх обʼєктів акаунта, тобто чужих орендарів (И11). Детально —
 * шапка `channex-catalog-live.mjs`.
 */
import './lib/module-aliases.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const organizationId = opt('--org');
const remoteOnly = opt('--remote');
const connectionId = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--org' && argv[i - 1] !== '--remote') ?? null;

if (!remoteOnly && (!organizationId || !connectionId)) {
  console.error('usage: node scripts/channex-mappings-live.mjs --org <orgId> <connId>   |   --remote <remotePropertyId>');
  console.error('  --org обовʼязковий: зʼєднання читається ЧЕРЕЗ орендаря (connectionInTenant), не за id (INC-010).');
  process.exit(2);
}
const apiKey = process.env.CHANNEX_API_KEY;
if (!apiKey) { console.error('немає CHANNEX_API_KEY в оточенні — далі йти нема куди'); process.exit(2); }
const environment = process.env.CHANNEX_ENV === 'production' ? 'production' : 'staging';
const BASE = environment === 'production' ? 'https://app.channex.io/api/v1' : 'https://staging.channex.io/api/v1';

/** Сире читання повз наш клієнт — звірка бачить відповідь, не наше тлумачення. */
async function get(path) {
  const res = await fetch(BASE + path, { headers: { 'user-api-key': apiKey } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** Той бік: типи номерів, тарифи з віссю пари, опції заселеності. */
async function readVendor(remotePropertyId) {
  const roomTypes = (await get(`/room_types?filter[property_id]=${remotePropertyId}`)).data ?? [];
  const planRows = (await get(`/rate_plans/options?filter[property_id]=${remotePropertyId}`)).data ?? [];
  const plansFull = (await get(`/rate_plans?filter[property_id]=${remotePropertyId}`)).data ?? [];
  const roomTitle = new Map(roomTypes.map((r) => [r.id, r.attributes?.title]));
  const plans = planRows.map((row) => {
    const id = row.attributes?.id ?? row.id;
    const full = plansFull.find((p) => p.id === id);
    return {
      id,
      title: row.attributes?.title,
      roomTypeId: row.attributes?.room_type_id,
      roomTitle: roomTitle.get(row.attributes?.room_type_id) ?? '?',
      sellMode: full?.attributes?.sell_mode ?? '?',
      currency: full?.attributes?.currency ?? '?',
      options: (full?.attributes?.options ?? []).map((o) => ({ id: String(o.id), occupancy: Number(o.occupancy), primary: !!o.is_primary })),
    };
  });
  return {
    roomTypes: roomTypes.map((r) => ({ id: r.id, title: r.attributes?.title, rooms: r.attributes?.count_of_rooms })),
    plans,
  };
}

function printVendor(v) {
  console.log(`\nТОЙ БІК (${environment}):`);
  console.log(`  типів номерів: ${v.roomTypes.length}`);
  for (const r of v.roomTypes) console.log(`    ${r.id}  ${r.title}  ×${r.rooms}`);
  console.log(`  тарифів (пар тип × тариф): ${v.plans.length}`);
  for (const p of v.plans) {
    console.log(`    ${p.id}  ${p.title} @ ${p.roomTitle}  ${p.sellMode} ${p.currency}  опції [${p.options.map((o) => `${o.occupancy}${o.primary ? '*' : ''}`).join(',')}]`);
  }
}

if (remoteOnly) {
  const v = await readVendor(remoteOnly);
  console.log('═'.repeat(74));
  console.log(`ОБʼЄКТ ВЕНДОРА ${remoteOnly} — лише читання, без бази`);
  console.log('═'.repeat(74));
  printVendor(v);
  console.log('\n(дзеркала тут немає: запустіть з --org <orgId> <connId> у середовищі з базою зʼєднання)');
  process.exit(0);
}

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { channelConnection, connectionMirror } = await import('@channels/live');
const { catalogUnitTypes } = await import('@properties/live');
const { listRatePlans } = await import('@pricing/live');

await runWithOrganization(organizationId, async () => {
  const connection = await channelConnection(connectionId);
  if (!connection) { console.error(`✗ зʼєднання ${connectionId} не наше або не існує`); process.exitCode = 1; return; }
  if (!connection.remotePropertyId) { console.error('✗ обʼєкт ще не заведено (remote_property_id порожній)'); process.exitCode = 1; return; }

  console.log('═'.repeat(74));
  console.log(`ЗʼЄДНАННЯ ${connectionId}  (обʼєкт ${connection.propertyId} → ${connection.remotePropertyId}, ${environment})`);
  console.log('═'.repeat(74));

  const v = await readVendor(connection.remotePropertyId);
  printVendor(v);

  const mirror = await connectionMirror(connectionId);
  const unitTypes = new Map((await catalogUnitTypes(connection.propertyId)).map((u) => [u.id, u]));
  const plans = new Map((await listRatePlans(connection.propertyId)).map((p) => [p.id, p]));
  const mirrorTypes = mirror.filter((m) => m.entityType === 'unit_type');
  const mirrorPairs = mirror.filter((m) => m.entityType === 'rate_plan');
  const mirrorOptions = mirror.filter((m) => m.entityType === 'rate_plan_option' && m.occupancy > 0);
  const remoteTypeOf = new Map(mirrorTypes.map((m) => [m.localId, m.remoteId]));

  console.log('\nДЗЕРКАЛО (cm_mappings):');
  for (const m of mirrorPairs) {
    const plan = plans.get(m.localId);
    const ut = unitTypes.get(m.unitTypeId);
    const state = !plan ? 'ТАРИФУ В БАЗІ НЕМАЄ' : plan.isActive ? 'продається' : 'ЗНЯТО З ПРОДАЖУ';
    const priced = plan?.pricedUnitTypes?.includes(ut?.code ?? '') ? 'є ціна' : 'БЕЗ ЦІНИ на цьому типі';
    console.log(`    ${m.remoteId}  ${plan?.code ?? m.localId} × ${ut?.code ?? m.unitTypeId}  — ${state}, ${priced}`);
  }

  // ── Три відповіді, кожна названа ─────────────────────────────────────
  const vendorIds = new Set(v.plans.map((p) => p.id));
  const mirrorIds = new Set(mirrorPairs.map((m) => m.remoteId));
  const extra = v.plans.filter((p) => !mirrorIds.has(p.id));
  const missing = mirrorPairs.filter((m) => !vendorIds.has(m.remoteId));
  const misplaced = mirrorPairs.filter((m) => {
    const theirs = v.plans.find((p) => p.id === m.remoteId);
    return theirs && theirs.roomTypeId !== remoteTypeOf.get(m.unitTypeId);
  });
  const vendorOptionIds = new Set(v.plans.flatMap((p) => p.options.map((o) => o.id)));
  const lostOptions = mirrorOptions.filter((o) => !vendorOptionIds.has(o.remoteId));
  const extraOptions = v.plans.flatMap((p) => p.options.filter((o) => !mirrorOptions.some((m) => m.remoteId === o.id)).map((o) => `${p.title}@${p.roomTitle} occ${o.occupancy}`));

  console.log('\nЗВІРКА:');
  console.log(`  зайве   (у вендора є, у дзеркалі нема): ${extra.length}` + (extra.length ? '\n' + extra.map((p) => `      ${p.id}  ${p.title} @ ${p.roomTitle}  — прибрати в панелі вендора або завести пару в нас`).join('\n') : ''));
  console.log(`  відсутнє (у дзеркалі є, у вендора нема): ${missing.length}` + (missing.length ? '\n' + missing.map((m) => `      ${m.remoteId}  ${plans.get(m.localId)?.code ?? m.localId} × ${unitTypes.get(m.unitTypeId)?.code ?? m.unitTypeId}  — кожна координата цієї пари поїде як unmapped`).join('\n') : ''));
  console.log(`  розбіжне (той самий id, інший тип): ${misplaced.length}` + (misplaced.length ? '\n' + misplaced.map((m) => `      ${m.remoteId}`).join('\n') : ''));
  console.log(`  опції: у дзеркалі є, у вендора нема — ${lostOptions.length}; у вендора є, у дзеркалі нема — ${extraOptions.length}` + (extraOptions.length ? `\n      ${extraOptions.join(', ')}` : ''));

  const clean = extra.length === 0 && missing.length === 0 && misplaced.length === 0 && lostOptions.length === 0 && extraOptions.length === 0;
  console.log(clean ? '\n✓ дзеркало і каталог вендора збігаються пара в пару' : '\n✗ є розбіжності — див. вище; нічого не змінено');
  if (!clean) process.exitCode = 1;
});
