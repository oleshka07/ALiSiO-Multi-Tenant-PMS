import { channexAdapter } from './channex/adapter';
import { setChannexResponseSink, type ChannexResponseSample } from './channex/client';
import type { PullReport } from './data/pull-bookings';
import type { CatalogReport } from './domain/catalog.ts';
import type { FlushReport } from './domain/ari-batch.ts';
import type { CatalogReconciliation } from './domain/reconcile.ts';
import type { SendsVerification } from './domain/verify.ts';
import type { ChannelEventKind, WebhookState } from './port';
import type { ChannelsSnapshot } from './data/channels.repo';

/**
 * Шов композиції: рядок провайдера → модуль адаптера. Більше нічого.
 *
 * Рівно один раз ім'я модуля вендора мусить бути написане — інакше жоден
 * маршрут до адаптера не дістанеться, і порт лишиться кресленням. Цей файл і
 * є тим разом, і саме тому він такий короткий: тут немає жодного чужого
 * поля, жодної умови на поведінку і жодного знання про протокол. Є
 * відповідність між значенням `cm_connections.provider` і модулем, який його
 * обслуговує.
 *
 * Гейт `check-vendor-isolation` знає про цей файл окремим, ВУЖЧИМ правилом
 * (не винятком): ім'я вендора дозволене тут лише в рядку `import` і як ключ
 * відповідності. Щойно сюди переповзе логіка — розгалуження поведінки, чуже
 * поле, URL — гейт упаде так само, як упав би на будь-якому доменному файлі.
 *
 * Один запис на провайдера, не шість функцій: коли вмінь стало шість
 * (стрічка, каталог, розсилка, ключ, вікно, звірка), шість таблиць
 * відповідності перестали б бути швом. Запис збирає сам адаптер у своїй
 * теці; тут лише відповідність.
 */

/** Усе, що модуль каналів просить від одного менеджера каналів. */
export interface ProviderAdapter {
  /** Як показати провайдера людині. Дані адаптера, не ядра. */
  label: string;
  pull: Puller;
  catalog: CatalogSyncer;
  publish: AriPublisher;
  /** Чи справжній ключ — одним читанням, до збереження. */
  probeKey(apiKey: string, environment: string): Promise<boolean>;
  /** Адреса вбудованого вікна мапінгу з разовим токеном, скутим на сервері. */
  frameUrl(connectionId: string, apiKey: string, options: { username: string; lng?: string }): Promise<string>;
  /** Звірка Ц8: створене — ще не продане. */
  reconcile(connectionId: string, apiKey: string): Promise<CatalogReconciliation>;
  /** Вебхук на обʼєкт — ідемпотентно, з читанням назад (Ц20). */
  ensureWebhook(connectionId: string, apiKey: string): Promise<WebhookState>;
  /** Новий секрет: спершу вендор, потім база. */
  rotateWebhookSecret(connectionId: string, apiKey: string): Promise<void>;
  /** Прибрати вебхук у вендора; зниклий — не помилка. */
  removeWebhook(connectionId: string, apiKey: string): Promise<{ existed: boolean }>;
  /** Вендор сам стукає в наші двері і віддає наш код і тіло (И27). */
  testWebhook(connectionId: string, apiKey: string): Promise<{ statusCode: number; body: string }>;
  /** Що це за подія для домену. Імена подій — лише в адаптері. */
  classifyEvent(eventType: string): ChannelEventKind;
  /** Звірка П6: відправлене проти календаря того боку; розбіжне — назад у чергу з причиною. */
  verify: SendsVerifier;
  /** Рівень OTA (К2): канали обʼєкта і каталог доступних — одним читанням. */
  channels(connectionId: string, apiKey: string): Promise<ChannelsSnapshot>;
}

/** Звірити останні відправлення одного зʼєднання з календарем менеджера каналів. */
export type SendsVerifier = (
  connectionId: string,
  apiKey: string,
  options?: { limit?: number; minAgeSeconds?: number; today?: string },
) => Promise<SendsVerification>;

/** Прочитати стрічку одного зʼєднання і завести з неї броні. */
export type Puller = (connectionId: string, apiKey: string) => Promise<PullReport>;

/** Завести каталог одного зʼєднання в менеджері каналів. */
export type CatalogSyncer = (connectionId: string, apiKey: string) => Promise<CatalogReport>;

/** Один прохід черги вихідних змін одного зʼєднання. */
export type AriPublisher = (
  connectionId: string,
  apiKey: string,
  options?: { today?: string },
) => Promise<FlushReport>;

/**
 * Записувач живих відповідей — для живих скриптів (інваріант 28). Сюди він
 * потрапляє через шов, бо це єдине місце, де імʼя модуля вендора дозволене.
 */
export const recordVendorResponses = setChannexResponseSink;
export type VendorResponseSample = ChannexResponseSample;

// Ключі — це ЗНАЧЕННЯ з `cm_connections.provider`, тому вони в лапках: це
// дані з бази, а не імена в коді.
const ADAPTERS: Record<string, ProviderAdapter> = {
  'channex': channexAdapter,
};

/** Адаптер цього провайдера цілком. Невідомий — `null`, не виняток. */
export function adapterFor(provider: string): ProviderAdapter | null {
  return ADAPTERS[provider] ?? null;
}

/** Провайдери, яких код знає, — для екрана, як дані. */
export function knownProviders(): { id: string; label: string }[] {
  return Object.entries(ADAPTERS).map(([id, a]) => ({ id, label: a.label }));
}

/**
 * Хто обслуговує цього провайдера.
 *
 * Невідомий провайдер — це `null`, а не виняток і не мовчазний пропуск: у
 * базі лежить значення, якого код не знає, і побачити це має оператор
 * (`unknown_provider` у звіті крона), а не наступний розробник.
 */
export function pullerFor(provider: string): Puller | null {
  return adapterFor(provider)?.pull ?? null;
}

/** Хто заводить каталог цього провайдера. Невідомий — `null`, не виняток. */
export function catalogSyncerFor(provider: string): CatalogSyncer | null {
  return adapterFor(provider)?.catalog ?? null;
}

/** Хто розсилає ARI цього провайдера. Невідомий — `null`, не виняток. */
export function ariPublisherFor(provider: string): AriPublisher | null {
  return adapterFor(provider)?.publish ?? null;
}
