import type { ProviderAdapter } from '../providers';
import { pullConnection } from './pull-adapter';
import { catalogSync } from './catalog-adapter';
import { ariFlush } from './ari-adapter';
import { probeKey, frameUrl, reconcile } from './connect-adapter';

/**
 * Усе, що цей вендор уміє, — одним записом для шва композиції.
 *
 * Шов (`providers.ts`) знає рівно один рядок: значення `provider` з бази →
 * цей обʼєкт. Що всередині — стрічка, каталог, розсилка, ключ, вікно,
 * звірка — вирішує ця тека, і лише вона (И1).
 */
export const channexAdapter: ProviderAdapter = {
  label: 'Channex',
  pull: pullConnection,
  catalog: catalogSync,
  publish: (connectionId, apiKey, options) => ariFlush(connectionId, apiKey, options),
  probeKey,
  frameUrl,
  reconcile,
};
