/**
 * Екран «Застосунки» — каталог і здоровʼя одного готелю.
 *
 * Лише власник, як `/api/settings/features`: це ключі, які тарифікують
 * організацію і доходять до її гостей. Жодного секрету у відповіді — лише
 * «є / останні чотири символи» через `integrationStatus`.
 *
 * Нічого нового для вмикання й ключів: вимикач — той самий
 * `PUT /api/settings/features`, ключі — той самий
 * `PUT /api/settings/integration-credentials`. Цей маршрут лише ЗБИРАЄ
 * відповідь для однієї картки з чотирьох джерел: реєстр застосунків
 * (`apps.ts`), реєстр фіч, стан ключів і стан звʼязку (`app_connections`).
 */
import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { hasFeature, type FeatureKey } from '@core/features';
import { appCatalog, isAppId, type AppEntry, type AppStatus } from '@core/apps';
import { PAYMENT_PROVIDERS, connectedPaymentProvider } from '@core/payments';
import { integrationStatus, type IntegrationChannel, type IntegrationStatus } from '@core/integration-credentials';
import { probeMail } from '@core/mail/email';
import {
  channelManagerHealth,
  listConnections,
  wishApp,
  wishedApps,
  type AppConnection,
} from '@core/app-connections';

/**
 * Застосунки, у яких є «Перевірити звʼязок». Лише пошта: її клієнт живе в
 * ядрі (`core/mail/email.ts`). Клієнт fiskaly — у `modules/invoicing/data`, і
 * дверей у фасаді `@invoicing` для проби немає; правильні двері — експорт у
 * фасаді, тека сесії 1 (звіт блоку, «потрібна зміна в чужій теці»).
 */
const PROBEABLE = new Set<string>(['smtp']);

export interface AppCard extends AppEntry {
  /** Є кнопка «Перевірити звʼязок». */
  probeable: boolean;
  /** Стан вимикача; `null` — вимикача немає (smtp, «скоро»). */
  enabled: boolean | null;
  /** Стан ключів: чи збережені й чиї. Лише для застосунків із полями. */
  keys: IntegrationStatus | null;
  /** Рядки стану звʼязку — по одному на обʼєкт (fiskaly) або один (smtp). */
  connections: AppConnection[];
  /** «Хочу» вже натиснуто — лише для «скоро». */
  wished: boolean;
}

export interface HealthRow {
  /** id застосунку, або `channel_manager` / `online_payments` для не-застосунків. */
  key: string;
  label: string;
  property_id: string | null;
  status: AppStatus;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
}

function statusOf(entry: AppEntry, enabled: boolean | null, rows: AppConnection[]): AppStatus {
  if (!entry.live) return 'soon';
  if (enabled === false) return 'disabled';
  if (!rows.length) return 'unknown';
  // Кілька обʼєктів — найгірший стан і є стан картки: одна зламана TSE
  // це зламана каса на тому обʼєкті, і «підключено» на картці збрехало б.
  const order: AppStatus[] = ['error', 'degraded', 'disabled', 'connected'];
  for (const s of order) if (rows.some((r) => r.status === s)) return s;
  return 'unknown';
}

export const getApps = withOwner(async (_req, _ctx, actor: Actor) => {
  const org = actor.organizationId;
  const [connections, wished, cm] = await Promise.all([
    listConnections(org),
    wishedApps(org),
    channelManagerHealth(org),
  ]);

  const cards: AppCard[] = [];
  for (const entry of appCatalog(PAYMENT_PROVIDERS)) {
    const enabled = entry.feature ? await hasFeature(org, entry.feature as FeatureKey) : null;
    const rows = connections.filter((c) => c.app === entry.id);
    const keys = entry.fields.length && entry.live
      ? await integrationStatus(entry.id as IntegrationChannel, org)
      : null;
    cards.push({
      ...entry,
      probeable: PROBEABLE.has(entry.id),
      enabled,
      keys,
      connections: rows,
      wished: wished.includes(entry.id),
      status: statusOf(entry, enabled, rows),
    });
  }

  // Здоровʼя: рядок на кожен звʼязок із чужою системою.
  const health: HealthRow[] = [];
  for (const card of cards) {
    if (!card.live) continue;
    if (card.connections.length) {
      for (const c of card.connections) {
        health.push({
          key: card.id, label: card.label, property_id: c.property_id,
          status: card.enabled === false ? 'disabled' : c.status,
          last_ok_at: c.last_ok_at, last_error_at: c.last_error_at, last_error: c.last_error,
        });
      }
    } else {
      health.push({
        key: card.id, label: card.label, property_id: null,
        status: card.status, last_ok_at: null, last_error_at: null, last_error: null,
      });
    }
  }
  // Менеджер каналів — не застосунок (З4), але звʼязок із чужою системою:
  // читається з cm_connections, без нового запису і без правки каналів.
  const channelsOn = await hasFeature(org, 'channels');
  if (cm.length) {
    for (const c of cm) {
      health.push({
        key: 'channel_manager', label: 'Менеджер каналів', property_id: c.property_id,
        status: !channelsOn ? 'disabled' : (c.is_enabled ? 'connected' : 'disabled'),
        last_ok_at: c.last_full_sync_at ?? c.catalog_synced_at, last_error_at: null, last_error: null,
      });
    }
  } else {
    health.push({
      key: 'channel_manager', label: 'Менеджер каналів', property_id: null,
      status: channelsOn ? 'unknown' : 'disabled', last_ok_at: null, last_error_at: null, last_error: null,
    });
  }
  // Онлайн-оплата: ключ є / коду немає — чесно, як PaymentGatewayNotice.
  const paymentsOn = await hasFeature(org, 'online_payments');
  const provider = paymentsOn ? await connectedPaymentProvider(org) : null;
  health.push({
    key: 'online_payments', label: 'Онлайн-оплата', property_id: null,
    status: !paymentsOn ? 'disabled' : (provider?.live ? 'unknown' : 'soon'),
    last_ok_at: null, last_error_at: null,
    last_error: provider && !provider.live ? `${provider.label}: ключ збережено, шлюз у продукті ще не написаний` : null,
  });

  return NextResponse.json({ cards, health });
});

/** POST /api/settings/apps/:id/wish — «хочу». Ідемпотентно (З2). */
export const wishForApp = withOwner(async (_req, ctx: { params: Promise<{ id: string }> }, actor: Actor) => {
  const { id } = await ctx.params;
  if (!isAppId(id)) return NextResponse.json({ error: 'Невідомий застосунок' }, { status: 404 });
  const entry = appCatalog(PAYMENT_PROVIDERS).find((e) => e.id === id);
  if (!entry || entry.live) {
    // «Хочу» — для того, чого ще немає. Live-застосунок вмикають, а не просять.
    return NextResponse.json({ error: 'Цей застосунок уже доступний — увімкніть його' }, { status: 409 });
  }
  await wishApp(actor.organizationId, id);
  return NextResponse.json({ wished: true, app: id });
});

/**
 * POST /api/settings/apps/:id/probe — «Перевірити звʼязок».
 *
 * Один справжній виклик до вендора ключами готелю, без листа; результат лягає
 * в `app_connections` тим самим шляхом, що й робочі виклики (`reported()` у
 * клієнті), і повертається рядком стану — з текстом відмови (З7). Лише
 * застосунки з `PROBEABLE`; решті — 409.
 */
export const probeApp = withOwner(async (_req, ctx: { params: Promise<{ id: string }> }, actor: Actor) => {
  const { id } = await ctx.params;
  const org = actor.organizationId;
  if (!isAppId(id)) return NextResponse.json({ error: 'Невідомий застосунок' }, { status: 404 });
  if (!PROBEABLE.has(id)) {
    return NextResponse.json({ error: 'Цей застосунок не перевіряється кнопкою' }, { status: 409 });
  }
  try {
    await probeMail(org);
  } catch (e) {
    // Відмова транспорту — не помилка сервера: вона вже лежить у app_connections
    // з текстом, і саме її має побачити готель. У відповідь іде рядок стану, а
    // не `e.message` (інваріант 6: текст обрізаний і записаний нами).
    console.error(`[apps] probe ${id} @ ${org}:`, e instanceof Error ? e.message : e);
  }
  const rows = (await listConnections(org)).filter((c) => c.app === id);
  return NextResponse.json({ app: id, connections: rows });
});
