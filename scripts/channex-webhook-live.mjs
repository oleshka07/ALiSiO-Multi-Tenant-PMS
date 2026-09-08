/**
 * Вебхук проти ЖИВОГО вендора: зареєструвати, прочитати назад, постукати, прибрати.
 *
 *   APP_URL=https://<наш-домен> node scripts/channex-webhook-live.mjs --org <orgId> <connId>
 *
 * Чотири речі, які на моку не доводяться (інваріант 27):
 *
 *   1. реєстрація — вендор віддає id, і ЧИТАННЯ НАЗАД окремим GET повз наш
 *      клієнт показує `is_active: true`, `send_data: false`, нашу адресу з
 *      токеном і заголовок секрету (без значення в друку);
 *   2. повторний вхід — той самий id, другого вебхука не зʼявилось;
 *   3. `POST /webhooks/test` — вендор САМ стукає в наші двері і повертає код,
 *      який побачив: 200 означає, що коло замкнене; 404/401/3xx — двері
 *      відповіли, але не цьому токену або не цій збірці (обидва — доказ, що
 *      адреса досяжна);
 *   4. прибирання — DELETE, і GET назад дає 404: у спільному акаунті не
 *      лишається нашого мертвого виклику (інваріант 25).
 *
 * Досліди — на своєму обʼєкті. Скрипт лишає вебхук зареєстрованим ЛИШЕ з
 * прапорцем `--keep`: так робить оператор на беті, коли адреса справжня.
 */
import './lib/module-aliases.mjs';
import { sampleRecorder } from './lib/channex-samples.mjs';

const argv = process.argv.slice(2);
let organizationId = null;
let connectionId = null;
let keep = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--org') { organizationId = argv[++i]; continue; }
  if (argv[i] === '--keep') { keep = true; continue; }
  if (!argv[i].startsWith('--')) connectionId = argv[i];
}
if (!organizationId || !connectionId || !process.env.APP_URL) {
  console.error('usage: APP_URL=https://<domain> node scripts/channex-webhook-live.mjs --org <orgId> <connId> [--keep]');
  process.exit(2);
}

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { integrationCredentials } = await import('@core/integration-credentials');
const { channelConnection, ensureConnectionWebhookFor, testConnectionWebhookFor, removeConnectionWebhookFor } = await import('@channels/live');
// Інваріант 28: кожна жива відповідь лягає зразком у docs/vendor/channex/live/.
const { recordVendorResponses } = await import('@channels/live');
recordVendorResponses(sampleRecorder());

const BASE = { staging: 'https://staging.channex.io/api/v1', production: 'https://app.channex.io/api/v1' };

/** Читання назад повз наш клієнт: голий fetch з ключем готелю. */
async function readBack(environment, key, id) {
  const res = await fetch(`${BASE[environment]}/webhooks/${id}`, { headers: { 'user-api-key': key } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, attributes: body?.data?.attributes ?? null };
}

await runWithOrganization(organizationId, async () => {
  const connection = await channelConnection(connectionId);
  if (!connection) { console.error('✗ зʼєднання не наше або не існує'); process.exitCode = 1; return; }
  const key = (await integrationCredentials('channel_manager', organizationId))?.accessToken;
  if (!key) { console.error('✗ у організації немає ключа менеджера каналів'); process.exitCode = 1; return; }
  console.log(`ЗʼЄДНАННЯ ${connectionId} (${connection.provider}, ${connection.environment}); адреса дверей — ${process.env.APP_URL}/api/webhooks/channel-manager/<токен>`);

  // 1. Реєстрація + читання назад повз клієнт.
  const first = await ensureConnectionWebhookFor(connectionId);
  const back = await readBack(connection.environment, key, first.remoteWebhookId);
  const a = back.attributes ?? {};
  const mask = String(a.event_mask ?? '').split(';');
  const okBack = back.status === 200 && a.is_active === true && a.send_data === false
    && a.callback_url === first.callbackUrl && a.headers && 'X-Webhook-Secret' in a.headers
    && mask.includes('booking') && !mask.includes('ari');
  console.log(`  1. реєстрація: id ${first.remoteWebhookId} (${first.created ? 'створено' : 'уже було'}); назад: HTTP ${back.status}, ` +
    `is_active=${a.is_active}, send_data=${a.send_data}, адреса ${a.callback_url === first.callbackUrl ? 'наша' : 'ЧУЖА'}, ` +
    `заголовок секрету ${a.headers && 'X-Webhook-Secret' in a.headers ? 'є' : 'НЕМАЄ'}, маска: booking ${mask.includes('booking') ? 'є' : 'НЕМАЄ'}, ari ${mask.includes('ari') ? 'Є ← луна' : 'немає'}`);
  if (!okBack) process.exitCode = 1;

  // 2. Повторний вхід — той самий id.
  const second = await ensureConnectionWebhookFor(connectionId);
  console.log(`  2. повторний вхід: id ${second.remoteWebhookId} ${second.remoteWebhookId === first.remoteWebhookId ? '— той самий' : '— ІНШИЙ ← подвоєння'}, створено: ${second.created}`);
  if (second.remoteWebhookId !== first.remoteWebhookId || second.created) process.exitCode = 1;

  // 3. Вендор стукає в наші двері.
  try {
    const t = await testConnectionWebhookFor(connectionId);
    console.log(`  3. пробна доставка: вендор отримав від ${process.env.APP_URL} код ${t.statusCode}${t.body ? ` (${String(t.body).slice(0, 80).replace(/\s+/g, ' ')})` : ''}`);
  } catch (e) {
    console.log(`  3. пробна доставка: вендор не зміг постукати — ${e instanceof Error ? e.message : e}`);
  }

  // 4. Прибирання і читання назад.
  if (keep) { console.log('  4. лишено зареєстрованим (--keep)'); return; }
  const removed = await removeConnectionWebhookFor(connectionId);
  const gone = await readBack(connection.environment, key, first.remoteWebhookId);
  console.log(`  4. прибирання: ${removed.existed ? 'видалено' : 'уже не було'}; назад: HTTP ${gone.status} ${gone.status === 404 ? '— слідів немає' : '← ЩЕ Є'}`);
  if (gone.status !== 404) process.exitCode = 1;
});
