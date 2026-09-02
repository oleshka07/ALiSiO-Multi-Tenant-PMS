/**
 * Прохід крона розсилки по всіх зʼєднаннях: пропуск, помилка і порожньо —
 * три різні речі.
 *
 *   node src/modules/channels/data/publish-all.check.ts
 *
 * Дзеркало `pull-all.check.ts`, і навмисно тієї ж форми: один готель без
 * модуля, один без ключа, одне вимкнене зʼєднання, один невідомий провайдер,
 * одне зʼєднання, що впало, — і жодне з них не зупиняє решту й не зникає з
 * доповіді. Плюс те, чого в стрічці немає: «потребує уваги» доповідається,
 * але крон від нього не червоніє — застрягла координата це справа екрана
 * оператора, а щохвилинний червоний крон на тиждень — це крон, який усі
 * вчаться ігнорувати.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import { publishAllConnections, type PublishAllDeps } from './publish-all.ts';
import type { FlushReport } from '../domain/ari-batch.ts';

const ok = (over: Partial<FlushReport> = {}): FlushReport => ({
  sent: 0, failed: 0, retired: 0, needsAttention: 0, calls: 0, errors: [], ...over,
});

interface World {
  organizations: string[];
  withFeature: Set<string>;
  connections: Record<string, { id: string; provider: string; isEnabled: boolean }[]>;
  withKey: Set<string>;
  outcome: Record<string, FlushReport | Error>;
}

function harness(world: Partial<World> = {}) {
  const w: World = {
    organizations: ['org-a'],
    withFeature: new Set(['org-a']),
    connections: { 'org-a': [{ id: 'conn-a', provider: 'probe', isEnabled: true }] },
    withKey: new Set(['org-a']),
    outcome: { 'conn-a': ok({ sent: 3, calls: 2 }) },
    ...world,
  };
  const log: string[] = [];
  const deps: PublishAllDeps = {
    organizations: async () => w.organizations,
    hasChannels: async (org) => w.withFeature.has(org),
    withOrganization: async (org, fn) => { log.push(`org:${org}`); return await fn(); },
    connections: async (org) => w.connections[org] ?? [],
    apiKey: async (org) => (w.withKey.has(org) ? `key-${org}` : null),
    publisherFor: (provider) => (provider === 'probe' ? 'probe-publisher' : null),
    publish: async (_publisher, connectionId) => {
      log.push(`publish:${connectionId}`);
      const out = w.outcome[connectionId];
      if (out instanceof Error) throw out;
      return out ?? ok();
    },
  };
  return { deps, log };
}

// ── Звичайний прохід: рахує те, що зробив ─────────────────────────────────
{
  const { deps, log } = harness();
  const r = await publishAllConnections(deps);
  assert.deepStrictEqual(log, ['org:org-a', 'publish:conn-a'], 'зʼєднання читається ВСЕРЕДИНІ контексту орендаря');
  assert.strictEqual(r.organizations, 1);
  assert.strictEqual(r.connections, 1);
  assert.strictEqual(r.sent, 3);
  assert.strictEqual(r.calls, 2);
  assert.strictEqual(r.failedOrganizations, 0);
  console.log('  ok  прохід рахує відправлене й виклики по всіх зʼєднаннях');
}

// ── Готель без модуля — тихо далі; вимкнене зʼєднання — не чіпається ──────
{
  const { deps, log } = harness({
    organizations: ['org-a', 'org-b'],
    connections: {
      'org-a': [{ id: 'conn-a', provider: 'probe', isEnabled: true }, { id: 'conn-off', provider: 'probe', isEnabled: false }],
      'org-b': [{ id: 'conn-b', provider: 'probe', isEnabled: true }],
    },
  });
  const r = await publishAllConnections(deps);
  assert.ok(!log.includes('publish:conn-off'), 'вимкнене зʼєднання нічого не шле — але й черги не втрачає (батчер)');
  assert.ok(!log.includes('org:org-b'), 'готель без модуля не відкривається взагалі');
  assert.strictEqual(r.skippedOrganizations, 1);
  assert.strictEqual(r.failedOrganizations, 0, 'ні модуль, ні вимкнене — не провал');
  console.log('  ok  без модуля — пропуск, вимкнене — не чіпається, і жодне не провал');
}

// ── Модуль є, зʼєднання є, ключа немає — найтихіший стан, і тому ПОМИЛКА ──
{
  const { deps } = harness({ withKey: new Set() });
  const r = await publishAllConnections(deps);
  assert.strictEqual(r.failedOrganizations, 1, 'без ключа черга росте, а канал мовчить — це мусить бути червоним');
  assert.ok(r.failures.some((f) => f.reason === 'missing_api_key'));
  console.log('  ok  відсутній ключ — провал із назвою');
}

// ── Провайдер, якого код не знає ──────────────────────────────────────────
{
  const { deps } = harness({ connections: { 'org-a': [{ id: 'conn-x', provider: 'martian', isEnabled: true }] } });
  const r = await publishAllConnections(deps);
  assert.strictEqual(r.failedOrganizations, 1);
  assert.ok(r.failures.some((f) => f.reason === 'unknown_provider' && f.connectionId === 'conn-x'));
  console.log('  ok  невідомий провайдер — провал із назвою, не мовчазний пропуск');
}

// ── Одне зʼєднання впало — решта йде ──────────────────────────────────────
{
  const { deps, log } = harness({
    organizations: ['org-a', 'org-b'],
    withFeature: new Set(['org-a', 'org-b']),
    withKey: new Set(['org-a', 'org-b']),
    connections: {
      'org-a': [{ id: 'conn-a', provider: 'probe', isEnabled: true }, { id: 'conn-a2', provider: 'probe', isEnabled: true }],
      'org-b': [{ id: 'conn-b', provider: 'probe', isEnabled: true }],
    },
    outcome: { 'conn-a': new Error('catalog not synced'), 'conn-a2': ok({ sent: 1 }), 'conn-b': ok({ sent: 2 }) },
  });
  const r = await publishAllConnections(deps);
  assert.deepStrictEqual(log.filter((l) => l.startsWith('publish:')), ['publish:conn-a', 'publish:conn-a2', 'publish:conn-b'],
    'падіння одного зʼєднання не спиняє ні сусіда, ні інший готель');
  assert.strictEqual(r.failedOrganizations, 1);
  assert.ok(r.failures.some((f) => f.connectionId === 'conn-a' && /publish_failed:catalog not synced/.test(f.reason)));
  assert.strictEqual(r.sent, 3);
  console.log('  ok  помилка одного зʼєднання названа, решта відпрацювала');
}

// ── «Потребує уваги» доповідається, але крон від нього не червоніє ────────
{
  const { deps } = harness({ outcome: { 'conn-a': ok({ failed: 2, needsAttention: 2, errors: ['rate: unmapped rp@ut'] }) } });
  const r = await publishAllConnections(deps);
  assert.strictEqual(r.needsAttention, 2, 'застрягле мусить бути в доповіді');
  assert.strictEqual(r.failed, 2);
  assert.strictEqual(r.failedOrganizations, 0,
    'застрягла координата — справа екрана оператора; червоний крон щохвилини на тиждень усі вчаться ігнорувати');
  assert.ok(r.attention.some((a) => a.connectionId === 'conn-a' && a.needsAttention === 2), 'і названо, ЯКЕ зʼєднання');
  console.log('  ok  застрягле доповідається поіменно, крон лишається зеленим');
}

console.log('publish-all: пропуск, помилка і порожньо — три різні речі; застрягле видно, але не червонить');
