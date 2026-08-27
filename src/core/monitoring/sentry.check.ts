/**
 * The envelope leaves this machine only in production, so its shape has to be
 * proven here: a malformed envelope is not an error anywhere — Sentry answers
 * 200 with an id and quietly drops the event, and "тихий тиждень" means a dead
 * integration, not a healthy system.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/core/monitoring/sentry.check.ts
 */
import { buildEnvelope, parseDsn, parseStack, captureError } from './sentry.ts';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) return;
  failed += 1;
  console.error(`  FAIL: ${msg}`);
}

// ── parseDsn ────────────────────────────────────────────────────────────────
const DSN = 'https://abc123@o4511458532720640.ingest.de.sentry.io/4511983966027856';
const parsed = parseDsn(DSN);
assert(
  parsed?.endpoint === 'https://o4511458532720640.ingest.de.sentry.io/api/4511983966027856/envelope/',
  `endpoint зібрано неправильно: ${parsed?.endpoint}`,
);
assert(parseDsn('not a dsn') === null, 'сміття замість DSN мусить дати null');
assert(parseDsn('https://host.example/123') === null, 'DSN без публічного ключа мусить дати null');
assert(parseDsn('https://k@host.example/abc') === null, 'DSN з нечисловим проєктом мусить дати null');

// ── parseStack ──────────────────────────────────────────────────────────────
const err = new Error('probe');
const frames = parseStack(err.stack);
assert(frames.length > 0, 'реальний Error.stack мусить дати кадри');
assert(
  frames.some((f) => f.filename.includes('sentry.check.ts') && typeof f.lineno === 'number'),
  'кадр цього файла з номером рядка мусить бути серед розібраних',
);
// Sentry чекає oldest-first: місце створення помилки — ОСТАННІЙ кадр.
const last = frames[frames.length - 1];
assert(
  (last.filename.includes('sentry.check.ts') && (last.lineno ?? 0) > 0),
  `останній кадр має бути місцем new Error(), а не коренем процесу: ${last.filename}:${last.lineno}`,
);

// ── buildEnvelope ───────────────────────────────────────────────────────────
const envelope = buildEnvelope(DSN, 'check-scope', err, '2026-08-27T00:00:00.000Z', 'a'.repeat(32));
const lines = envelope.split('\n');
assert(lines.length === 3, `конверт має рівно три рядки, є ${lines.length}`);
const [head, item, event] = lines.map((l) => JSON.parse(l));
assert(head.dsn === DSN && head.event_id === 'a'.repeat(32), 'шапка несе dsn і event_id');
assert(item.type === 'event', 'другий рядок оголошує тип event');
assert(event.level === 'error' && event.platform === 'node', 'подія — серверна помилка');
assert(event.tags?.scope === 'check-scope', 'scope із serverError їде тегом');
assert(event.exception?.values?.[0]?.value === 'probe', 'текст помилки на місці');
assert(
  Array.isArray(event.exception?.values?.[0]?.stacktrace?.frames) &&
    event.exception.values[0].stacktrace.frames.length > 0,
  'stacktrace.frames не порожній',
);

// Не-Error значення не мають ламати конверт: throw 'рядок' трапляється.
const strEnvelope = buildEnvelope(DSN, 's', 'просто рядок', '2026-08-27T00:00:00.000Z', 'b'.repeat(32));
const strEvent = JSON.parse(strEnvelope.split('\n')[2]);
assert(strEvent.exception.values[0].value === 'просто рядок', 'кинутий рядок стає текстом помилки');

// ── captureError без DSN — мовчазний no-op ──────────────────────────────────
delete process.env.SENTRY_DSN;
try {
  captureError('noop-check', new Error('мусить нікуди не полетіти і не впасти'));
} catch (e) {
  failed += 1;
  console.error('  FAIL: captureError без DSN кинув виняток:', e);
}

if (failed > 0) {
  console.error(`sentry: ${failed} перевірок упало`);
  process.exit(1);
}
console.log('sentry: конверт, стек і no-op — усі перевірки пройшли');
