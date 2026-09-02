/**
 * Стрічка бронювань проти ЖИВОГО вендора — один прохід одного зʼєднання.
 *
 *   node scripts/channex-pull-live.mjs --org <orgId> <connId>
 *
 * Той самий прохід, що робить крон `channels-pull` і що будить вебхук
 * (`pullConnectionNow`): стрічка дочитується, ревізії зводяться з бронями,
 * `ack` — після коміту (И5). Друкується звіт: скільки побачено, застосовано,
 * повторів, підтверджено, і кожна пропущена — з причиною.
 *
 * Читання, яке змінює стан: `ack` прибирає ревізію зі стрічки назавжди
 * (інваріант 25) — тому лише на СВОЄМУ обʼєкті. Порожня стрічка — теж
 * результат: зразок форми `GET /booking_revisions/feed` (інваріант 28)
 * лягає в `docs/vendor/channex/live/` і без броні.
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
  console.error('usage: node scripts/channex-pull-live.mjs --org <orgId> <connId>');
  process.exit(2);
}

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { channelConnection, pullConnectionNow } = await import('@channels');
// Інваріант 28: кожна жива відповідь лягає зразком у docs/vendor/channex/live/.
const { recordVendorResponses } = await import('@channels');
recordVendorResponses(sampleRecorder());

await runWithOrganization(organizationId, async () => {
  const connection = await channelConnection(connectionId);
  if (!connection) { console.error('✗ зʼєднання не наше або не існує'); process.exitCode = 1; return; }
  console.log(`ЗʼЄДНАННЯ ${connectionId} (${connection.provider}, ${connection.environment}); увімкнено: ${connection.isEnabled}`);
  const report = await pullConnectionNow(connectionId);
  if (!report) { console.log('  пропущено: зʼєднання вимкнене або модуль не куплений — крон робить те саме'); return; }
  console.log(`  стрічка: побачено ${report.seen}, застосовано ${report.applied}, повторів ${report.duplicates}, підтверджено ${report.acked}, пропущено ${report.skipped.length}`);
  for (const s of report.skipped) console.log(`    пропущено ${s.remoteRevisionId ?? '?'} (бронь ${s.remoteBookingId ?? '?'}): ${s.reason}`);
});
