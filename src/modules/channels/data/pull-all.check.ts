/**
 * Прохід крона по всіх готелях: кого пропустити, а про кого закричати.
 *
 *   node src/modules/channels/data/pull-all.check.ts
 *
 * Крон не має орендаря — він працює за всіх, — і саме тому це найтихіше
 * місце в інтеграції. Один запит без контексту організації тут не падає: на
 * Postgres він повертає НУЛЬ рядків, крон рапортує «оброблено 0» і виглядає
 * здоровим рівно доти, доки готель не спитає, чому броні з Booking.com не
 * приходять уже тиждень.
 *
 * ── Три роди «нічого не сталося», які не можна плутати ──────────────────
 *
 *   пропущено   — готель не купував модуль каналів або вимкнув зʼєднання.
 *                 Це нормальний стан, і він мовчазний.
 *   зламано     — модуль є, а ключа немає, стрічка не відповідає, база
 *                 впала. Це ПОМИЛКА, і вона мусить дійти до оператора
 *                 ненульовим `failedOrganizations`: `deploy/run-cron.sh`
 *                 читає тіло відповіді й падає саме на ньому.
 *   порожньо    — усе працює, нових броней немає.
 *
 * Злити перше з другим означає крон, який вічно зелений; злити третє з
 * другим — алерт щохвилини, який навчаються ігнорувати.
 *
 * Перевірка написана ДО реалізації і **була червоною** (інваріант 24).
 */
import assert from 'node:assert';
import { pullAllConnections, type PullAllDeps } from './pull-all.ts';
import type { FeedEntry } from '../domain/feed.ts';

const entry = (id: string): FeedEntry => ({
  ok: true,
  revision: {
    remoteRevisionId: id,
    ackToken: `ack-${id}`,
    remoteBookingId: `bkg-${id}`,
    status: 'new',
    totalAmount: 100,
    unmapped: false,
    rooms: [{ unitTypeId: 'ut', checkIn: '2026-10-10', checkOut: '2026-10-11', adults: 2, children: 0, amount: 100 }],
    raw: {},
  },
});

interface World {
  organizations: string[];
  /** Хто купив модуль каналів. */
  withFeature: Set<string>;
  /** Зʼєднання по організаціях. */
  connections: Record<string, { id: string; provider: string; isEnabled: boolean }[]>;
  /** Хто зберіг ключ API. */
  withKey: Set<string>;
  feed: Record<string, FeedEntry[]>;
}

function harness(world: Partial<World> = {}) {
  const w: World = {
    organizations: ['org-a'],
    withFeature: new Set(['org-a']),
    connections: { 'org-a': [{ id: 'conn-a', provider: 'probe', isEnabled: true }] },
    withKey: new Set(['org-a']),
    feed: { 'conn-a': [entry('r1')] },
    ...world,
  };
  const log: string[] = [];

  const deps: PullAllDeps = {
    organizations: async () => w.organizations,
    hasChannels: async (org) => w.withFeature.has(org),
    withOrganization: async (org, fn) => { log.push(`org:${org}`); return await fn(); },
    connections: async (org) => w.connections[org] ?? [],
    apiKey: async (org) => (w.withKey.has(org) ? `key-${org}` : null),
    pullerFor: (provider) => (provider === 'probe' ? 'probe-puller' : null),
    pull: async (_puller, connectionId) => {
      log.push(`pull:${connectionId}`);
      const feed = w.feed[connectionId] ?? [];
      if (feed.some((e) => !e.ok && e.reason === 'boom')) throw new Error('стрічка не відповіла');
      return { seen: feed.length, applied: feed.length, duplicates: 0, skipped: [], acked: feed.length };
    },
  };
  return { log, deps, w };
}

// ─── Звичайний прохід ───────────────────────────────────────────────────────
{
  const { log, deps } = harness();
  const report = await pullAllConnections(deps);
  assert.deepStrictEqual(log, ['org:org-a', 'pull:conn-a'],
    'зʼєднання прочитано ПОЗА контекстом організації — на Postgres це нуль рядків без помилки');
  assert.strictEqual(report.applied, 1);
  assert.strictEqual(report.failedOrganizations, 0);
  console.log('  ok  прохід іде всередині контексту організації, а не поруч');
}

// ─── Готель без модуля каналів — мовчазний пропуск ──────────────────────────
//
// Це не помилка: він його не купував. Кричати про це щохвилини означає
// навчити оператора ігнорувати алерти цього крона взагалі.
{
  const { log, deps } = harness({ withFeature: new Set() });
  const report = await pullAllConnections(deps);
  assert.ok(!log.some((l) => l.startsWith('pull:')),
    'готель без модуля каналів усе одно пішов у стрічку — це запит за чужий рахунок');
  assert.strictEqual(report.failedOrganizations, 0, 'відсутній модуль порахували помилкою');
  assert.strictEqual(report.skippedOrganizations, 1);
  console.log('  ok  готель без модуля пропускається мовчки, а не падає');
}

// ─── Вимкнене зʼєднання теж пропускається ──────────────────────────────────
{
  const { log, deps } = harness({
    connections: { 'org-a': [{ id: 'conn-a', provider: 'probe', isEnabled: false }] },
  });
  const report = await pullAllConnections(deps);
  assert.ok(!log.some((l) => l.startsWith('pull:')), 'вимкнене зʼєднання все одно опитали');
  assert.strictEqual(report.failedOrganizations, 0);
  console.log('  ok  вимкнене зʼєднання не опитується');
}

// ─── Модуль є, ключа немає — ЦЕ ПОМИЛКА ────────────────────────────────────
//
// Найтихіший стан з усіх: готель купив канали, підключення налаштоване,
// ключ не зберігся або стерся. Мовчазний пропуск дав би вічно зелений крон і
// готель, який тиждень не бачить броней.
{
  const { log, deps } = harness({ withKey: new Set() });
  const report = await pullAllConnections(deps);
  assert.ok(!log.some((l) => l.startsWith('pull:')));
  assert.strictEqual(report.failedOrganizations, 1,
    'готель із модулем але без ключа порахували пропуском — крон лишиться вічно зеленим');
  assert.ok(report.failures.some((f) => f.reason === 'missing_api_key'),
    'причина не названа — оператор побачить лише число');
  console.log('  ok  модуль без ключа — помилка з назвою, а не тихий пропуск');
}

// ─── Падіння одного готелю не спиняє решту ─────────────────────────────────
//
// Інакше перший же зламаний клієнт забирає з собою всіх наступних, і що
// гірший стан у одного, то менше броней бачать інші.
{
  const { log, deps } = harness({
    organizations: ['org-a', 'org-b', 'org-c'],
    withFeature: new Set(['org-a', 'org-b', 'org-c']),
    withKey: new Set(['org-a', 'org-b', 'org-c']),
    connections: {
      'org-a': [{ id: 'conn-a', provider: 'probe', isEnabled: true }],
      'org-b': [{ id: 'conn-b', provider: 'probe', isEnabled: true }],
      'org-c': [{ id: 'conn-c', provider: 'probe', isEnabled: true }],
    },
    feed: {
      'conn-a': [entry('a1')],
      'conn-b': [{ ok: false, reason: 'boom' }],
      'conn-c': [entry('c1')],
    },
  });
  const report = await pullAllConnections(deps);
  assert.ok(log.includes('pull:conn-c'),
    'падіння на другому готелі заглушило третій — так губиться половина клієнтів');
  assert.strictEqual(report.applied, 2);
  assert.strictEqual(report.failedOrganizations, 1);
  assert.ok(report.failures[0].organizationId === 'org-b');
  console.log('  ok  падіння одного готелю не спиняє решту, і його названо');
}

// ─── Порожньо — це успіх, а не тривога ─────────────────────────────────────
{
  const { deps } = harness({ feed: { 'conn-a': [] } });
  const report = await pullAllConnections(deps);
  assert.strictEqual(report.applied, 0);
  assert.strictEqual(report.failedOrganizations, 0,
    'відсутність нових броней порахували помилкою — алерт щохвилини вчить його ігнорувати');
  console.log('  ok  порожня стрічка — успіх, не тривога');
}

// ─── Жодного готелю з каналами — теж успіх ─────────────────────────────────
{
  const { deps } = harness({ organizations: [] });
  const report = await pullAllConnections(deps);
  assert.strictEqual(report.failedOrganizations, 0);
  assert.strictEqual(report.applied, 0);
  console.log('  ok  порожній сервер не робить крон червоним');
}

// ─── Провайдер, якого код не знає ───────────────────────────────────────────
//
// У базі лежить рядок провайдера; код знає скінченний їх список. Розбіжність
// означає або недокочену міграцію, або зʼєднання, заведене руками, — і
// побачити це має ОПЕРАТОР, а не наступний розробник через півроку. Мовчазний
// пропуск дав би готель, чиї броні не приходять, і крон, який каже «все
// добре».
{
  const { log, deps } = harness({
    connections: { 'org-a': [{ id: 'conn-a', provider: 'невідомий', isEnabled: true }] },
  });
  const report = await pullAllConnections(deps);
  assert.ok(!log.some((l) => l.startsWith('pull:')));
  assert.strictEqual(report.failedOrganizations, 1,
    'зʼєднання з невідомим провайдером пропустили мовчки — крон лишиться зеленим');
  assert.ok(report.failures.some((f) => f.reason === 'unknown_provider'),
    'причина не названа — у звіті буде лише число');
  console.log('  ok  невідомий провайдер — названа помилка, а не тихий пропуск');
}

console.log('pull-all: пропуск, помилка і порожньо — три різні речі');
