/**
 * Майстер підключення проти ЖИВОГО вендора: ключ, вікно, звірка.
 *
 *   node scripts/channex-connect-live.mjs --org <orgId> <connId>
 *
 * Три речі, які на стенді в памʼяті не доводяться (інваріант 27):
 *
 *   1. ключ перевіряється одним GET — і чужий ключ падає, а не мовчить;
 *   2. разовий токен для вікна кується на сервері — вендор його віддає, і
 *      адреса вікна складається без ключа в ній;
 *   3. звірка Ц8 читає канали обʼєкта назад: «N з N тарифів не змаплені».
 *
 * Токен і адреса вікна НЕ друкуються: це перепустка на 15 хвилин. Друкується
 * лише те, що вона отримана і що ключа в ній немає. Досліди — на своєму
 * обʼєкті (інваріант 25); токен не спалюється (вікно не відкривається), і
 * за 15 хвилин зникне сам.
 */
import './lib/module-aliases.mjs';
import { sampleRecorder } from './lib/channex-samples.mjs';

const argv = process.argv.slice(2);
let organizationId = null;
let connectionId = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--org') { organizationId = argv[++i]; continue; }
  if (!argv[i].startsWith('--')) connectionId = argv[i];
}
if (!organizationId || !connectionId) {
  console.error('usage: node scripts/channex-connect-live.mjs --org <orgId> <connId>');
  process.exit(2);
}

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { integrationCredentials } = await import('@core/integration-credentials');
const {
  channelConnection, channelSetupState, probeChannelKeyFor, channelFrameUrlFor, reconcileConnectionCatalogFor,
} = await import('@channels');
// Інваріант 28: кожна жива відповідь лягає зразком у docs/vendor/channex/live/.
const { recordVendorResponses } = await import('@channels');
recordVendorResponses(sampleRecorder());

await runWithOrganization(organizationId, async () => {
  const connection = await channelConnection(connectionId);
  if (!connection) { console.error('✗ зʼєднання не наше або не існує'); process.exitCode = 1; return; }
  console.log(`ЗʼЄДНАННЯ ${connectionId} (${connection.provider}, ${connection.environment}, обʼєкт ${connection.propertyId})`);

  const state = await channelSetupState(connection.propertyId);
  console.log(`  стан майстра з бази: крок «${state.step}», ключ ${state.hasKey ? 'є' : 'нема'}${state.keyHint ? ` (${state.keyHint})` : ''}`);

  // 1. Ключ — справжній і чужий.
  const key = (await integrationCredentials('channel_manager', organizationId))?.accessToken;
  if (!key) { console.error('✗ у організації немає ключа менеджера каналів'); process.exitCode = 1; return; }
  const good = await probeChannelKeyFor(connection.provider, key, connection.environment);
  const bad = await probeChannelKeyFor(connection.provider, 'definitely-not-a-key', connection.environment);
  console.log(`  1. ключ: справжній → ${good}, чужий → ${bad}`);
  if (!good || bad) process.exitCode = 1;

  // 2. Токен і адреса вікна — отримані, ключа в адресі немає.
  const url = await channelFrameUrlFor(connectionId, { username: 'live-check@alisio.local', lng: 'de' });
  const hasToken = /oauth_session_key=[0-9a-f-]{20,}/.test(url);
  const leaks = url.includes(key);
  console.log(`  2. вікно: токен ${hasToken ? 'отримано' : 'НЕ отримано'}, ключа в адресі ${leaks ? 'Є ← ВИТІК' : 'немає'}, ` +
    `параметри ${['app_mode=headless', 'redirect_to=%2Fchannels', 'lng=de'].every((p) => url.includes(p)) ? 'на місці' : 'НЕПОВНІ'}`);
  if (!hasToken || leaks) process.exitCode = 1;

  // 3. Звірка — читання каналів назад.
  const r = await reconcileConnectionCatalogFor(connectionId);
  console.log(`  3. звірка: каналів ${r.channels}, тарифів ${r.total}, не змаплені ${r.unmapped.length}, лише на вимкнених ${r.onlyInactive.length}, продається: ${r.sellable ? 'так' : 'ні'}`);
  console.log(`     ${r.unmapped.length} з ${r.total} тарифів не змаплені на жоден канал`);
});
