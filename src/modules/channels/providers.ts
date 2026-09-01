import { pullConnection as channexPull } from './channex/pull-adapter';
import { catalogSync as channexCatalog } from './channex/catalog-adapter';
import { ariFlush as channexAri } from './channex/ari-adapter';
import type { PullReport } from './data/pull-bookings';
import type { CatalogReport } from './domain/catalog.ts';
import type { FlushReport } from './domain/ari-batch.ts';

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
 * (не винятком): ім'я вендора дозволене тут лише в рядку `import`. Щойно
 * сюди переповзе логіка — розгалуження поведінки, чуже поле, URL — гейт
 * упаде так само, як упав би на будь-якому доменному файлі.
 *
 * Ознака, що шов перестав бути швом: у ньому більше десятка рядків. Три
 * записи на провайдера (стрічка, каталог, розсилка ARI) — це все ще
 * відповідність, а не логіка: усі мають одну форму
 * `(connectionId, apiKey) => звіт`, і жодної умови на поведінку тут немає.
 */

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

// Ключі — це ЗНАЧЕННЯ з `cm_connections.provider`, тому вони в лапках: це
// дані з бази, а не імена в коді.
const PULLERS: Record<string, Puller> = {
  'channex': channexPull,
};

const CATALOG_SYNCERS: Record<string, CatalogSyncer> = {
  'channex': channexCatalog,
};

const ARI_PUBLISHERS: Record<string, AriPublisher> = {
  'channex': channexAri,
};

/**
 * Хто обслуговує цього провайдера.
 *
 * Невідомий провайдер — це `null`, а не виняток і не мовчазний пропуск: у
 * базі лежить значення, якого код не знає, і побачити це має оператор
 * (`unknown_provider` у звіті крона), а не наступний розробник.
 */
export function pullerFor(provider: string): Puller | null {
  return PULLERS[provider] ?? null;
}

/** Хто заводить каталог цього провайдера. Невідомий — `null`, не виняток. */
export function catalogSyncerFor(provider: string): CatalogSyncer | null {
  return CATALOG_SYNCERS[provider] ?? null;
}

/** Хто розсилає ARI цього провайдера. Невідомий — `null`, не виняток. */
export function ariPublisherFor(provider: string): AriPublisher | null {
  return ARI_PUBLISHERS[provider] ?? null;
}
