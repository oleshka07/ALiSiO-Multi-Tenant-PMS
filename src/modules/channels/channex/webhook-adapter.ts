import crypto from 'node:crypto';
import { appBaseUrl } from '@core/app-url';
import type { ChannelEventKind, WebhookState } from '../port';
import { ChannexClient, type ChannexClientOptions, type ChannexEnvironment } from './client';
import { webhookRegistration, rememberRemoteWebhook, storeWebhookSecret, type WebhookRegistration } from '../data/connections.repo';

/**
 * Вебхук вендора на обʼєкт — з боку адаптера.
 *
 *   node src/modules/channels/channex/webhook-adapter.check.ts
 *
 * ── Сигнал, не дані ─────────────────────────────────────────────────────
 *
 * Підпису у вебхуків немає (webhook-collection.md: «do not include a
 * built-in HMAC signature»); є лише власний заголовок у полі `headers`.
 * Тому `send_data: false` — у тілі лише `event`, `user_id`, `property_id`,
 * `timestamp`, жодної броні. Вебхук каже «опитай стрічку зараз»; правдою
 * лишається стрічка ревізій з `ack` і дедуплікацією. Підроблений вебхук з
 * правильним секретом коштує одного зайвого опитування. Вебхук пришвидшує,
 * стрічка гарантує — крон не вимикається (Ц20).
 *
 * ── Прочитане назад, не факт створення ──────────────────────────────────
 *
 * `is_active` і `send_data` за замовчуванням `false`: створений без явного
 * `is_active: true` вебхук існує і мовчить — той самий клас, що «тариф
 * створено, але ніде не змаплено». Тому після POST — GET, і твердження
 * стверджує прочитане; «мовчить» лагодиться PUT-ом, невиліковне — відмова.
 *
 * ── Маска без `ari` ─────────────────────────────────────────────────────
 *
 * Подія `ari` приходить і на НАШІ відправки (И9); нам вона не потрібна —
 * ціни в кабінеті вендора не редагуються. Зірочки теж немає: «усе, що
 * вендор вигадає потім» — це не підписка, а сюрприз.
 */

export const WEBHOOK_SECRET_HEADER = 'X-Webhook-Secret';

export const WEBHOOK_EVENT_MASK = [
  // бронь: будить прохід стрічки
  'booking',
  // увага оператора: мапінг, підтвердження, синк, канали, видалення
  'booking_unmapped_room', 'booking_unmapped_rate', 'non_acked_booking',
  'sync_error', 'rate_error',
  'disconnect_channel', 'deactivate_channel',
  'channel_removal_warning', 'property_removal_warning',
  // листування (фаза 6): підписані вже, щоб журнал не мав дірки
  'message', 'message_thread_booking_assigned', 'inquiry',
].join(';');

const BOOKING_EVENTS = new Set(['booking', 'booking_new', 'booking_modification', 'booking_cancellation']);
const MESSAGE_EVENTS = new Set(['message', 'message_thread_booking_assigned', 'inquiry']);
const IGNORED_EVENTS = new Set(['ari', 'new_channel', 'updated_channel', 'activate_channel', 'sync_warning', 'review', 'updated_review']);

/** Що це за подія для домену. Невідоме — увага: комусь треба подивитись, а не мовчати. */
export function classifyEvent(eventType: string): ChannelEventKind {
  if (BOOKING_EVENTS.has(eventType)) return 'booking';
  if (MESSAGE_EVENTS.has(eventType)) return 'message';
  if (IGNORED_EVENTS.has(eventType)) return 'ignore';
  return 'attention';
}

export interface WebhookAdapterOptions {
  /** Перекриття клієнта — мок-сервер у перевірці. */
  client?: Partial<ChannexClientOptions>;
}

/** Адреса наших дверей для цього зʼєднання. Без адреси сервера — відмова, не відносний шлях. */
function callbackUrlFor(token: string): string {
  const base = appBaseUrl();
  if (!base) throw new Error('app url not configured: set APP_URL before registering a webhook');
  return `${base}/api/webhooks/channel-manager/${token}`;
}

/** Models.WebhookWriteModel — дослівно. */
function writeModel(reg: WebhookRegistration, secret: string, callbackUrl: string): Record<string, unknown> {
  return {
    property_id: reg.remotePropertyId,
    callback_url: callbackUrl,
    event_mask: WEBHOOK_EVENT_MASK,
    headers: { [WEBHOOK_SECRET_HEADER]: secret },
    is_active: true,
    send_data: false,
  };
}

async function registrationOf(connectionId: string): Promise<WebhookRegistration> {
  const reg = await webhookRegistration(connectionId);
  if (!reg) throw new Error('connection not found');
  if (!reg.remotePropertyId) throw new Error('catalog not synced: the connection has no remote property yet');
  return reg;
}

function clientFor(reg: WebhookRegistration, apiKey: string, options: WebhookAdapterOptions): ChannexClient {
  return new ChannexClient({ apiKey, environment: reg.environment as ChannexEnvironment, ...(options.client ?? {}) });
}

function silent(attributes: Record<string, unknown>): boolean {
  return attributes.is_active !== true || attributes.send_data !== false;
}

/**
 * Зареєструвати вебхук на обʼєкт — ідемпотентно.
 *
 * Спершу `remote_webhook_id`: є — читаємо назад; вендор його не має (404) —
 * створюємо заново; немає id — створюємо. Після створення — читання назад.
 * Мовчазний (неактивний або з даними) — PUT і ще одне читання; мовчить і
 * після цього — відмова з назвою, не «зареєстровано».
 */
export async function ensureWebhook(connectionId: string, apiKey: string, options: WebhookAdapterOptions = {}): Promise<WebhookState> {
  const reg = await registrationOf(connectionId);
  const callbackUrl = callbackUrlFor(reg.token);
  const client = clientFor(reg, apiKey, options);
  const model = writeModel(reg, reg.secret, callbackUrl);

  let id = reg.remoteWebhookId;
  let created = false;
  let attributes = id ? await client.getWebhook(connectionId, id) : null;

  if (!attributes) {
    const made = await client.createWebhook(connectionId, model);
    id = made.id;
    created = true;
    await rememberRemoteWebhook(connectionId, id);
    attributes = await client.getWebhook(connectionId, id);
    if (!attributes) throw new Error('webhook vanished right after creation');
  }

  if (silent(attributes) || attributes.callback_url !== callbackUrl) {
    await client.updateWebhook(connectionId, id!, model);
    attributes = await client.getWebhook(connectionId, id!);
    if (!attributes) throw new Error('webhook vanished right after repair');
  }

  if (silent(attributes)) {
    throw new Error('webhook inactive after repair: the vendor keeps it silent (is_active must be true, send_data false)');
  }

  return { remoteWebhookId: id!, callbackUrl, isActive: true, sendData: false, created };
}

/**
 * Новий секрет: спершу вендор, потім база. У зворотному порядку база була б
 * упевнена в секреті, якого вендор не знає, і кожна доставка діставала б 401.
 */
export async function rotateWebhookSecret(connectionId: string, apiKey: string, options: WebhookAdapterOptions = {}): Promise<void> {
  const reg = await registrationOf(connectionId);
  if (!reg.remoteWebhookId) throw new Error('webhook not registered: nothing to rotate');
  const secret = crypto.randomBytes(32).toString('hex');
  const client = clientFor(reg, apiKey, options);
  await client.updateWebhook(connectionId, reg.remoteWebhookId, writeModel(reg, secret, callbackUrlFor(reg.token)));
  await storeWebhookSecret(connectionId, secret);
}

/** Прибрати вебхук у вендора і стерти слід. Зниклий на тому боці — не помилка. */
export async function removeWebhook(connectionId: string, apiKey: string, options: WebhookAdapterOptions = {}): Promise<{ existed: boolean }> {
  const reg = await webhookRegistration(connectionId);
  if (!reg) throw new Error('connection not found');
  if (!reg.remoteWebhookId) return { existed: false };
  const client = clientFor(reg, apiKey, options);
  const existed = await client.deleteWebhook(connectionId, reg.remoteWebhookId);
  await rememberRemoteWebhook(connectionId, null);
  return { existed };
}

/** Вендор сам стукає в наші двері з чинним секретом і віддає наш код і тіло (И27). */
export async function testWebhook(connectionId: string, apiKey: string, options: WebhookAdapterOptions = {}): Promise<{ statusCode: number; body: string }> {
  const reg = await registrationOf(connectionId);
  const client = clientFor(reg, apiKey, options);
  return client.testWebhook(connectionId, writeModel(reg, reg.secret, callbackUrlFor(reg.token)));
}
