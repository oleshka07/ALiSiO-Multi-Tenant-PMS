/**
 * Локальний стенд під живі проходи — на ВЖЕ ЗАВЕДЕНОМУ обʼєкті вендора.
 *
 *   node scripts/channex-live-sandbox.mjs --property <remotePropertyId> --up
 *   node scripts/channex-live-sandbox.mjs --down
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * `channex-ari-live.mjs` ганяє справжній батчер справжніми числами, тож йому
 * потрібен орендар із обʼєктом, типами номерів, тарифами, цінами, зʼєднанням
 * і дзеркалом мапінгу. Заводити це руками — півгодини на прогін, тобто
 * прогін не робиться ніколи; заводити каталог у вендора наново — нові
 * сутності в СПІЛЬНОМУ акаунті, які потім хтось побачить у своїй адмінці
 * (інваріант 25).
 *
 * Тому стенд дзеркалить те, що на обʼєкті ВЖЕ Є: читає його типи номерів і
 * тарифи через `GET`, заводить локальні відповідники з тими самими
 * місткостями й опціями заселеності, і кладе мапінг на існуючі
 * ідентифікатори. Нічого не створює на тому боці.
 *
 * ── Що саме дзеркалиться ────────────────────────────────────────────────
 *
 * Тариф вендора належить ТИПУ НОМЕРА, наш — обʼєкту (Ц10): тарифи з
 * однаковою назвою на різних типах зводяться в ОДИН наш тариф із парами на
 * кожен тип. Це не спрощення стенда — це рівно та вісь, на якій стоїть
 * дзеркало `cm_mappings`, і стенд без неї доводив би менше, ніж треба.
 *
 * ── Ціни ────────────────────────────────────────────────────────────────
 *
 * Кладе `bulkUpdatePrices` — справжній писач, тож координати лягають у чергу
 * самі (Ц16). Числа беруться з `--price`; вони поїдуть у календар вендора
 * при першому ж проході батчера, і це навмисно: стенд для того й є.
 *
 * ── Прибирання ──────────────────────────────────────────────────────────
 *
 * `--down` стирає ВСЕ локальне під префіксом `__cxlive__`. На боці вендора
 * не лишається нічого, крім чисел у календарі власного тестового обʼєкта —
 * їх туди кладе прохід, і саме вони й є результатом прогону.
 */
import './lib/module-aliases.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const UP = argv.includes('--up');
const DOWN = argv.includes('--down');
if (!UP && !DOWN) {
  console.error('usage: node scripts/channex-live-sandbox.mjs --property <id> --up | --down [--price 2500] [--from YYYY-MM-DD] [--days N]');
  process.exit(2);
}

const ORG = '__cxlive__org';
const PROP = '__cxlive__prop';
const CAT = '__cxlive__cat';
const CONN = '__cxlive__conn';

/**
 * Ключ шифрування облікових даних тут ВИМАГАЄТЬСЯ, а не вигадується.
 *
 * `channex-multiroom-live.mjs` кує його собі сам, і це правильно: там усе —
 * засів, прохід, прибирання — в ОДНОМУ процесі. Тут інакше: стенд лишається
 * жити, а `channex-ari-live.mjs` запускається окремим процесом, і ключ,
 * вигаданий цим процесом, той не відтворить. Наслідок був би тихим рівно
 * настільки, наскільки тут не можна: збережений ключ вендора не
 * розшифрувався б, прохід упав би на «no channel manager key», і виглядало б
 * це як зламана варта, а не як загублений ключ.
 *
 * Значення довільне (стенд локальний і тимчасовий), головне — ОДНЕ на всі
 * команди прогону.
 */
if (!process.env.APP_SECRET_KEY) {
  console.error('✗ немає APP_SECRET_KEY. Стенд і прохід — різні процеси, тож ключ мусить бути спільним:');
  console.error(`    export APP_SECRET_KEY=${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`);
  console.error('  (довільний, лише для локального стенда; у git не потрапляє)');
  process.exit(2);
}

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const sql = getSql();

async function down() {
  await runWithOrganization(ORG, async () => {
    for (const t of ['cm_sends', 'cm_inbound_bookings', 'cm_events', 'cm_outbox', 'cm_mappings']) {
      await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => {});
    }
    await sql.run('DELETE FROM reservations WHERE organization_id = ?', [ORG]).catch(() => {});
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]).catch(() => {});
    await sql.run('DELETE FROM channel_credentials WHERE organization_id = ?', [ORG]).catch(() => {});
    await sql.run('DELETE FROM organization_features WHERE organization_id = ?', [ORG]).catch(() => {});
    await sql.run('DELETE FROM price_occupancy WHERE organization_id = ?', [ORG]).catch(() => {});
    // Ціни календаря НЕ стираються звідси: `price_calendar` належить модулю
    // цін, і SQL до неї ззовні — пробій межі (`check-boundaries`), який гейт
    // справедливо спіймав на першій же редакції цього скрипта. Вона зникає
    // сама разом із типом номера — `unit_type_id … ON DELETE CASCADE`, — тож
    // порядок нижче не косметичний: типи йдуть ПЕРЕД тарифами, інакше
    // невидалені рядки календаря тримали б тариф зовнішнім ключем.
    await sql.run("DELETE FROM units WHERE id LIKE '__cxlive__%'", []).catch(() => {});
    await sql.run("DELETE FROM unit_types WHERE id LIKE '__cxlive__%'", []).catch(() => {});
    await sql.run("DELETE FROM rate_plans WHERE id LIKE '__cxlive__%'", []).catch(() => {});
    await sql.run("DELETE FROM categories WHERE id LIKE '__cxlive__%'", []).catch(() => {});
    await sql.run("DELETE FROM properties WHERE id LIKE '__cxlive__%'", []).catch(() => {});
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]).catch(() => {});
}

if (DOWN && !UP) {
  await down();
  console.log('стенд прибрано');
  process.exit(0);
}

const REMOTE = opt('--property');
if (!REMOTE) { console.error('--property обовʼязковий для --up'); process.exit(2); }
const apiKey = process.env.CHANNEX_API_KEY;
if (!apiKey) { console.error('немає CHANNEX_API_KEY в оточенні'); process.exit(2); }
const HOST = (process.env.CHANNEX_ENV ?? 'staging') === 'production'
  ? 'https://app.channex.io' : 'https://staging.channex.io';
const PRICE = Number(opt('--price', '2500'));
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const FROM = opt('--from', addDays(new Date().toISOString().slice(0, 10), 30));
const DAYS = Math.max(1, Number(opt('--days', '5')) || 5);
/** `--new-plan CODE:per_room` — тариф, якого у вендора ще немає (Ц26). */
const NEW_PLANS = argv.reduce((acc, a, i) => (a === '--new-plan' && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const newPlans = [];

async function get(path) {
  const res = await fetch(`${HOST}/api/v1${path}`, { headers: { 'user-api-key': apiKey } });
  const t = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

// ── Читаємо, що на обʼєкті вже є ───────────────────────────────────────────
const roomTypes = (await get(`/room_types?filter[property_id]=${encodeURIComponent(REMOTE)}`)).data ?? [];
const ratePlans = (await get(`/rate_plans?filter[property_id]=${encodeURIComponent(REMOTE)}`)).data ?? [];
if (!roomTypes.length || !ratePlans.length) {
  console.error('✗ на обʼєкті немає типів номерів або тарифів — стенд нема з чого дзеркалити');
  process.exit(1);
}

const typeOf = new Map();      // remote room_type id → { local, code, adults, rooms }
let n = 0;
for (const rt of roomTypes) {
  const a = rt.attributes ?? {};
  const code = String(a.title ?? `RT${n}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || `RT${n}`;
  typeOf.set(rt.id, {
    local: `__cxlive__ut${n}`, code,
    adults: Math.max(1, Number(a.occ_adults) || 1),
    rooms: Math.max(1, Number(a.count_of_rooms) || 1),
    title: String(a.title ?? code),
  });
  n++;
}

/**
 * Тарифи вендора зводяться в наші за НАЗВОЮ: у них тариф належить типу
 * номера, у нас обʼєкту (Ц10). «Best Available» на Double і на Single — це
 * ОДИН наш тариф із двома парами, і саме так його бачить дзеркало.
 */
const plans = new Map();       // назва → { local, code, pairs: [{ remoteId, remoteType, options }] }
let p = 0;
for (const rp of ratePlans) {
  const a = rp.attributes ?? {};
  const remoteType = rp.relationships?.room_type?.data?.id;
  if (!remoteType || !typeOf.has(remoteType)) continue;
  const title = String(a.title ?? `RP${p}`);
  if (!plans.has(title)) {
    const code = title.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || `RP${p}`;
    plans.set(title, { local: `__cxlive__rp${p}`, code, title, sellMode: a.sell_mode === 'per_room' ? 'per_room' : 'per_person', pairs: [] });
    p++;
  }
  plans.get(title).pairs.push({
    remoteId: rp.id,
    remoteType,
    options: (a.options ?? []).map((o) => ({ occupancy: Number(o.occupancy), id: String(o.id) })),
  });
}

await down();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'CX live', ORG]);

const { setFeature } = await import('@core/features');
const { saveIntegrationCredentials } = await import('@core/integration-credentials');
const { bulkUpdatePrices } = await import('@pricing');

await runWithOrganization(ORG, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
    [PROP, ORG, 'CX live', PROP]);
  await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);

  for (const t of typeOf.values()) {
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code,
                               max_adults, max_children, max_occupancy, base_occupancy)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [t.local, PROP, CAT, t.title, t.code, t.adults, t.adults, Math.min(2, t.adults)]);
    for (let i = 0; i < t.rooms; i++) {
      await sql.run(
        `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [`${t.local}_u${i}`, PROP, t.local, CAT, `${t.code}-${i + 1}`, `${t.code}${i + 1}`]);
    }
    // Матриця заселеності: ціна на кожну кількість дорослих. Без неї
    // `priceNights` не котирує неосновні опції, і половина календаря вендора
    // лишилась би без числа.
    for (let persons = 1; persons <= t.adults; persons++) {
      await sql.run(
        `INSERT INTO price_occupancy (id, organization_id, property_id, unit_type_id, persons, price_gross)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [`${t.local}_occ${persons}`, ORG, PROP, t.local, persons, PRICE + (persons - 1) * 500]);
    }
  }

  for (const plan of plans.values()) {
    await sql.run(
      'INSERT INTO rate_plans (id, property_id, name, code, currency, sell_mode, is_active) VALUES (?, ?, ?, ?, ?, ?, TRUE)',
      [plan.local, PROP, plan.title, plan.code, 'EUR', plan.sellMode]);
  }

  await sql.run(
    `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment,
                                 remote_property_id, webhook_token, webhook_secret, is_enabled)
     VALUES (?, ?, ?, 'channex', ?, ?, ?, ?, TRUE)`,
    [CONN, ORG, PROP, process.env.CHANNEX_ENV ?? 'staging', REMOTE,
      `cxlive_${Date.now()}`, `cxlive_secret_${Date.now()}`]);

  // Дзеркало: обʼєкт, типи, пари «тип × тариф» і опції заселеності (И13).
  const put = (entity, localId, unitTypeId, occupancy, remoteId) => sql.run(
    `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), ORG, CONN, entity, localId, unitTypeId, occupancy, remoteId]);

  await put('property', PROP, '', 0, REMOTE);
  for (const [remoteId, t] of typeOf) await put('unit_type', t.local, '', 0, remoteId);
  for (const plan of plans.values()) {
    for (const pair of plan.pairs) {
      const local = typeOf.get(pair.remoteType).local;
      await put('rate_plan', plan.local, local, 0, pair.remoteId);
      for (const o of pair.options) {
        if (!(o.occupancy > 0)) continue;
        await put('rate_plan_option', plan.local, local, o.occupancy, o.id);
      }
    }
  }

  await setFeature(ORG, 'channels', true);
  await saveIntegrationCredentials(ORG, 'channel_manager', { accessToken: apiKey });

  // Ціни — справжнім писачем: координати лягають у чергу самі (Ц16).
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(FROM, i));
  for (const plan of plans.values()) {
    for (const pair of plan.pairs) {
      const local = typeOf.get(pair.remoteType).local;
      await bulkUpdatePrices({
        unitTypeId: local, ratePlanId: plan.local,
        dateFrom: dates[0], dateTo: dates[dates.length - 1], base_price: PRICE,
      });
    }
  }

  /**
   * Тарифи, яких у вендора ЩЕ НЕМАЄ — під прогін заведення каталогу (Ц26).
   *
   * `--new-plan ROOM:per_room --new-plan PP:per_person` дає рівно той стан,
   * з якого починається §0.3 передачі: тариф є в нас, має ціну на типі й не
   * має рядка в дзеркалі. Далі `channex-catalog-live.mjs --confirm` заводить
   * його на тому боці, і читання назад показує, скільки опцій заселеності
   * вендор зробив: «за номер» — одну, «за особу» — на кожну кількість
   * дорослих. Два режими разом навмисно: з одним «режим доїхав» і «режим
   * завжди той самий» невідрізнювані (інваріант 26).
   */
  const firstType = [...typeOf.values()][0];
  for (const spec of NEW_PLANS) {
    const [code, mode] = spec.split(':');
    const id = `__cxlive__new_${code}`.slice(0, 60);
    await sql.run(
      'INSERT INTO rate_plans (id, property_id, name, code, currency, sell_mode, is_active) VALUES (?, ?, ?, ?, ?, ?, TRUE)',
      [id, PROP, code, code, 'EUR', mode === 'per_room' ? 'per_room' : 'per_person']);
    await bulkUpdatePrices({
      unitTypeId: firstType.local, ratePlanId: id,
      dateFrom: dates[0], dateTo: dates[dates.length - 1], base_price: PRICE,
    });
    newPlans.push({ id, code, mode, unitType: firstType });
  }
});

console.log('═'.repeat(70));
console.log(`СТЕНД ПІДНЯТО → обʼєкт вендора ${REMOTE}`);
console.log(`  орендар    ${ORG}`);
console.log(`  зʼєднання  ${CONN}`);
console.log(`  дати       ${FROM}…${addDays(FROM, DAYS - 1)} по ${PRICE} (матриця +500 за кожного наступного дорослого)`);
for (const t of typeOf.values()) console.log(`  тип        ${t.local}  ${t.code}  (${t.rooms} номерів, до ${t.adults} дор.)`);
for (const plan of plans.values()) {
  console.log(`  тариф      ${plan.local}  ${plan.code}  режим ${plan.sellMode}  пар ${plan.pairs.length}`);
}
for (const np of newPlans) {
  console.log(`  НОВИЙ      ${np.id}  ${np.code}  режим ${np.mode}  на типі ${np.unitType.code} — у вендора ще НЕМАЄ`);
}
console.log('═'.repeat(70));
console.log('далі:');
console.log(`  node scripts/channex-ari-live.mjs --org ${ORG} ${CONN} --from ${FROM} --days ${DAYS}`);
console.log(`  node scripts/channex-ari-live.mjs --org ${ORG} ${CONN} --retire <rpId> --from ${FROM} --days ${DAYS}`);
if (newPlans.length) console.log(`  node scripts/channex-catalog-live.mjs ${CONN} --confirm   # завести нові тарифи у вендора`);
console.log('прибрати: node scripts/channex-live-sandbox.mjs --down');
if (newPlans.length) console.log('  …і НЕ забути прибрати заведені тарифи у вендора: DELETE /rate_plans/<id> (інваріант 25)');
