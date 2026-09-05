/**
 * Рівень OTA проти живого вендора — каталог, канали, читання назад (К2).
 *
 *   node scripts/channex-channels-live.mjs --property <remotePropertyId>
 *   node scripts/channex-channels-live.mjs --property <id> --org <orgId> <connId>
 *   node scripts/channex-channels-live.mjs --property <id> --org <orgId> <connId> --confirm
 *
 * Без `--confirm` — лише читання: каталог адаптерів вендора і канали обʼєкта
 * як вони є. З `--org <orgId> <connId>` те саме проходить крізь НАШ адаптер і
 * дзеркало, тобто показує рівно те, що покаже екран.
 *
 * ── Навіщо `--confirm` ──────────────────────────────────────────────────
 *
 * Бо на наших обʼєктах staging каналів НЕМАЄ ЖОДНОГО (виміряно 06.09.2026:
 * `GET /channels` по кожному з них — `total: 0`), і живого зразка відповіді з
 * непорожньою `data` не існує. Тобто поля, на які спирається адаптер
 * (`channel`, `is_active`, `rate_plans[].rate_plan_id`), досі не бачені
 * живими — інваріант 28 не виконано, і `live-fields.json` чесно тримає їх під
 * `awaiting`.
 *
 * `--confirm` це виправляє найдешевшим способом, який не бреше: створює
 * підключення каналу на НАШОМУ обʼєкті, читає його назад, прогонить через наш
 * адаптер — і видаляє. Це безпечно рівно тому, що каже документація вендора:
 * «The connection is created disabled and exchanges no data until it is
 * activated». Ми не викликаємо ні `test_connection`, ні `activate`, а
 * `send_email_notifications` лишається `false` за замовчуванням: OTA про це
 * підключення не дізнається взагалі.
 *
 * ── Досліди лише на СВОЇХ обʼєктах (інваріант 25) ───────────────────────
 *
 * Акаунт staging спільний. Скрипт пише виключно в обʼєкт, названий у
 * `--property`, і нічого не шукає сам. Створене підключення видаляється в
 * `finally` — і якщо видалити не вдалося, скрипт каже про це голосно, з
 * ідентифікатором, бо залишений канал у чужому акаунті це рядок, який хтось
 * побачить у своїй адмінці.
 *
 * `hotel_id` — свідомо неправдоподібне число, і це не недбалість: підключення
 * ніколи не активується, а правдоподібний чужий ідентифікатор — саме те, що
 * могло б повʼязати нашу пробу зі справжнім готелем.
 */
import './lib/module-aliases.mjs';
import { sampleRecorder } from './lib/channex-samples.mjs';

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const REMOTE_PROPERTY = opt('--property');
/**
 * Який адаптер брати за пробу.
 *
 * НЕ Booking.com: `POST /channels` з `channel: 'BookingCom'` на цьому
 * staging-акаунті віддає `500 internal_server_error` — і з мапінг-айтемами, і
 * без них (виміряно 06.09.2026). Схоже, адаптер там не провіжений; для нашої
 * мети це байдуже, бо форма відповіді `GET /channels` однакова для всіх
 * адаптерів, а перевіряємо ми саме її.
 */
const PROBE_CHANNEL = opt('--channel', 'Expedia');
const ORG = opt('--org');
let CONN = null;
for (let i = 0; i < argv.length; i++) {
  if (['--property', '--org'].includes(argv[i])) { i++; continue; }
  if (argv[i].startsWith('--')) continue;
  CONN = argv[i];
}
if (!REMOTE_PROPERTY) {
  console.error('usage: node scripts/channex-channels-live.mjs --property <id> [--org <orgId> <connId>] [--confirm]');
  process.exit(2);
}
if (CONFIRM && (!ORG || !CONN)) {
  console.error('--confirm потребує --org <orgId> <connId>: дзеркало пишеться ЧЕРЕЗ орендаря, не за самим id');
  process.exit(2);
}

const apiKey = process.env.CHANNEX_API_KEY;
if (!apiKey) { console.error('немає CHANNEX_API_KEY в оточенні'); process.exit(2); }
const HOST = (process.env.CHANNEX_ENV ?? 'staging') === 'production'
  ? 'https://app.channex.io' : 'https://staging.channex.io';

async function raw(method, path, body) {
  const res = await fetch(`${HOST}/api/v1${path}`, {
    method,
    headers: { 'user-api-key': apiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// ── Каталог адаптерів: «доступні OTA» ──────────────────────────────────────
//
// Через НАШ клієнт, а не сирим fetch: лише так відповідь лягає зразком у
// docs/vendor/channex/live/ (інваріант 28). Сирий `raw()` нижче лишається
// для того, що клієнт робити не вміє й не має — створення й видалення проби.
const { recordVendorResponses } = await import('@channels');
recordVendorResponses(sampleRecorder());
// До `--confirm` дивимось сирим: двері модуля ходять до вендора й пишуть
// дзеркало, а це вже дія — звіт її не робить.
const catalogRaw = (await raw('GET', '/channels/list')).data ?? [];
const byKind = catalogRaw.reduce((acc, c) => ({ ...acc, [c.kind || '—']: (acc[c.kind || '—'] ?? 0) + 1 }), {});
console.log(`КАТАЛОГ АДАПТЕРІВ: ${catalogRaw.length} — ${Object.entries(byKind).map(([k, n]) => `${k}: ${n}`).join(', ')}`);
for (const c of catalogRaw.filter((x) => ['BookingCom', 'AirBNB', 'Expedia'].includes(x.code))) {
  console.log(`  ${String(c.code).padEnd(12)} ${String(c.title).padEnd(14)} kind=${c.kind} листування=${c.message_support}`);
}

// ── Канали обʼєкта, як вони є ──────────────────────────────────────────────
const before = (await raw('GET', `/channels?filter[property_id]=${encodeURIComponent(REMOTE_PROPERTY)}`)).data ?? [];
console.log(`\nКАНАЛИ ОБʼЄКТА ${REMOTE_PROPERTY}: ${before.length}`);
for (const row of before) {
  const a = row.attributes ?? {};
  console.log(`  ${row.id} ${a.channel} «${a.title}» активний=${a.is_active} змаплених тарифів=${(a.rate_plans ?? []).length}`);
}

if (!CONFIRM) {
  console.log('\nнічого не створено — додайте --confirm, щоб побачити ЖИВУ відповідь із непорожньою data');
  process.exit(0);
}

// ── Наш бік: пари з дзеркала, щоб змапити хоч одну ─────────────────────────
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { channelConnection, connectionMirror, refreshConnectionChannelsFor } = await import('@channels');

let created = null;
try {
  const pairs = await runWithOrganization(ORG, async () => {
    const conn = await channelConnection(CONN);
    if (!conn) throw new Error(`зʼєднання ${CONN} не наше або не існує`);
    if (conn.remotePropertyId !== REMOTE_PROPERTY) {
      throw new Error(`зʼєднання дивиться на ${conn.remotePropertyId}, а --property каже ${REMOTE_PROPERTY}`);
    }
    return (await connectionMirror(CONN)).filter((m) => m.entityType === 'rate_plan');
  });
  if (!pairs.length) throw new Error('у дзеркалі немає жодної пари тип × тариф — нема чого мапити');
  console.log(`\nНАШИХ ПАР У ДЗЕРКАЛІ: ${pairs.length}; мапимо на канал першу — ${pairs[0].remoteId}`);

  // Підключення каналу — СТВОРЮЄТЬСЯ ВИМКНЕНИМ і даними не обмінюється.
  // Ані `test_connection`, ані `activate` не викликаються навмисно.
  // Група обʼєкта — обовʼязкова при створенні («the group and property IDs»),
  // і читається з самого обʼєкта: акаунт може мати кілька, а вгадана чужа
  // дає 422 «You not have access to requested group» (виміряно 06.09.2026).
  const propertyRaw = await raw('GET', `/properties/${encodeURIComponent(REMOTE_PROPERTY)}`);
  const groupId = propertyRaw?.data?.relationships?.groups?.data?.[0]?.id;
  if (!groupId) throw new Error('в обʼєкта немає групи — створити підключення каналу нема в чому');
  console.log(`група обʼєкта: ${groupId}`);

  const madeRaw = await raw('POST', '/channels', {
    channel: {
      channel: PROBE_CHANNEL,
      title: 'ALiSiO probe — delete me',
      group_id: groupId,
      properties: [REMOTE_PROPERTY],
      settings: {
        // Неправдоподібний навмисно: підключення не активується ніколи, а
        // правдоподібний чужий id повʼязав би пробу зі справжнім готелем.
        hotel_id: '00000000',
        email: 'probe@example.invalid',
        send_email_notifications: false,
      },
      rate_plans: [{
        rate_plan_id: pairs[0].remoteId,
        settings: {
          rate_plan_code: 'PROBE', room_type_code: 'PROBE',
          occupancy: 2, primary_occ: true, pricing_type: 'per_room', readonly: false,
        },
      }],
    },
  });
  created = madeRaw?.data?.id;
  console.log(`створено підключення ${created} (вимкнене, обміну немає)`);

  // ── Читання назад — сирим GET, повз наш клієнт ───────────────────────────
  const one = await raw('GET', `/channels/${encodeURIComponent(created)}`);
  const attrs = one?.data?.attributes ?? {};
  console.log('\nЧИТАННЯ НАЗАД (сире):');
  console.log(`  ключі відповіді: ${Object.keys(attrs).sort().join(', ')}`);
  console.log(`  channel=${attrs.channel} is_active=${attrs.is_active} title=«${attrs.title}»`);
  console.log(`  settings: ${JSON.stringify(attrs.settings)}`);
  console.log(`  rate_plans: ${JSON.stringify(attrs.rate_plans)}`);

  // ── Крізь ДВЕРІ модуля — рівно те, що покаже екран ──────────────────────
  //
  // Не власним переліком викликів: скрипт, який складає адаптер, дзеркало і
  // переклад сам, доводить свою збірку, а не ту, яку побачить готельєр.
  await runWithOrganization(ORG, async () => {
    const view = await refreshConnectionChannelsFor(CONN, apiKey);
    console.log(`\nЕКРАН (дзеркало оновлено ${view.syncedAt}, каталог ${view.catalog.length} адаптерів):`);
    for (const c of view.channels) {
      console.log(`  ${c.otaCode} «${c.title}» ${c.isActive ? 'активний' : 'вимкнений'}`);
      for (const p of c.pairs) console.log(`      продається: ${p.ratePlanCode} × ${p.unitTypeCode}`);
      if (!c.pairs.length) console.log('      ⚠ жодної НАШОЇ пари — тарифи каналу не з нашого каталогу');
      if (c.foreignRatePlans) console.log(`      ⚠ тарифів каналу не з нашого дзеркала: ${c.foreignRatePlans}`);
    }
    if (view.skipped?.length) console.log(`  не прочитано каналів: ${view.skipped.join(', ')}`);
    console.log(`\nЗВІРКА Ц8: пар у дзеркалі ${view.totalPairs}, не змаплено на жоден канал ${view.unmapped.length}, `
      + `лише на вимкнені ${view.onlyInactive.length}`);
    for (const p of view.unmapped.slice(0, 5)) console.log(`  ⚠ ${p.ratePlanCode} × ${p.unitTypeCode}`);
  });

  console.log('\n✓ рівень OTA прочитано живим: каталог, канал, мапінг-айтеми, переклад у наші пари');
} catch (e) {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      await raw('DELETE', `/channels/${encodeURIComponent(created)}`);
      console.log(`підключення ${created} видалено — акаунт лишається таким, яким був`);
    } catch (e) {
      console.error(`⚠⚠ ПІДКЛЮЧЕННЯ ${created} ЛИШИЛОСЬ В АКАУНТІ: ${e instanceof Error ? e.message : e}`);
      console.error('   приберіть його руками: DELETE /api/v1/channels/' + created);
      process.exitCode = 1;
    }
  }
}
