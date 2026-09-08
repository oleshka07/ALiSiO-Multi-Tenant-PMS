/**
 * Двері модуля каналів БЕЗ HTTP — для інструментів оператора й живих проходів.
 *
 * Та сама логіка, що в `connect.handlers.ts`, без варти маршруту: викликач сам
 * стоїть у контексті орендаря (`runWithOrganization`). Скрипт, який імпортував
 * би нутрощі модуля, ловить `check-boundaries`; ці двері існують саме тому.
 *
 * ── Чому окремим файлом, а не в обробниках ──────────────────────────────
 *
 * `connect.handlers.ts` імпортує `next/server` першим рядком, а прод-образ
 * Next standalone вхідних точок `next/*` не містить. Поки ці функції лежали
 * там, кожен, хто їх імпортував, тягнув із собою `next/server` — і падав
 * лише на сервері, у скрипті, який запускають руками. За добу 06–07.09.2026
 * цей клас вистрілив чотири рази (`apply-hotel` двічі, потім живий прохід
 * ARI, який через це не запускався взагалі). Тримає
 * `scripts/check-entry-imports.mjs`: він піднімає КОЖЕН вхід, названий у
 * DEPLOY.md, з гачком, що відмовляє на `next/*`.
 *
 * Тому правило файлу просте: тут не буває ні `NextResponse`, ні
 * `withPermission`, ні імпорту `@properties`/`@pricing` цілком — лише шари
 * даних і провайдери.
 */
import { integrationCredentials } from '@core/integration-credentials';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { adapterFor } from '../providers';
import { connectionInTenant } from '../data/connections.repo';

export async function apiKeyOf(organizationId: string): Promise<string | null> {
  const creds = await integrationCredentials('channel_manager', organizationId);
  return creds?.accessToken ?? null;
}

/** Стан вебхука після спроби зареєструвати — ніколи не виняток. */
export type WebhookAttempt =
  | { registered: true; created: boolean; callbackUrl: string }
  | { registered: false; error: 'app_url_not_configured' | 'webhook_inactive' | 'catalog_not_synced' | 'unknown_provider' | 'no_key' | 'vendor_unavailable' };

export function webhookErrorCode(error: unknown): Extract<WebhookAttempt, { registered: false }>['error'] {
  const message = error instanceof Error ? error.message : String(error);
  if (/app url/i.test(message)) return 'app_url_not_configured';
  if (/inactive/i.test(message)) return 'webhook_inactive';
  if (/catalog not synced/i.test(message)) return 'catalog_not_synced';
  return 'vendor_unavailable';
}

export async function registerWebhookSoftly(connectionId: string, provider: string, organizationId: string): Promise<WebhookAttempt> {
  const adapter = adapterFor(provider);
  if (!adapter) return { registered: false, error: 'unknown_provider' };
  const apiKey = await apiKeyOf(organizationId);
  if (!apiKey) return { registered: false, error: 'no_key' };
  try {
    const state = await adapter.ensureWebhook(connectionId, apiKey);
    return { registered: true, created: state.created, callbackUrl: state.callbackUrl };
  } catch (error: unknown) {
    const code = webhookErrorCode(error);
    if (code === 'vendor_unavailable' || code === 'webhook_inactive') {
      console.error('[channels] webhook registration failed', error instanceof Error ? error.message : error);
    }
    return { registered: false, error: code };
  }
}

// ── Двері без HTTP — для інструментів оператора й живого прогону ──────────
//
// Та сама логіка, що в обробниках вище, без варти маршруту: викликач сам
// стоїть у контексті орендаря (`runWithOrganization`). Скрипт, який імпортував
// би нутрощі модуля, ловить `check-boundaries`; ці двері існують саме тому.

/** Чи справжній ключ — до збереження. Кидає, якщо вендор недоступний. */
export async function probeChannelKeyFor(provider: string, apiKey: string, environment: string): Promise<boolean> {
  const adapter = adapterFor(provider);
  if (!adapter) throw new Error(`connect: unknown provider ${provider}`);
  return adapter.probeKey(apiKey, environment);
}

/** Адреса вбудованого вікна мапінгу. Не журналювати — це перепустка. */
export async function channelFrameUrlFor(connectionId: string, options: { username: string; lng?: string }): Promise<string> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('connect: frame without a tenant');
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('connect: connection not found');
  const adapter = adapterFor(connection.provider);
  if (!adapter) throw new Error(`connect: unknown provider ${connection.provider}`);
  const apiKey = await apiKeyOf(organizationId);
  if (!apiKey) throw new Error('connect: no channel manager key for this organization');
  return adapter.frameUrl(connectionId, apiKey, options);
}

/** Звірка Ц8 для одного зʼєднання. */
export async function reconcileConnectionCatalogFor(connectionId: string) {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('connect: reconcile without a tenant');
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('connect: connection not found');
  const adapter = adapterFor(connection.provider);
  if (!adapter) throw new Error(`connect: unknown provider ${connection.provider}`);
  const apiKey = await apiKeyOf(organizationId);
  if (!apiKey) throw new Error('connect: no channel manager key for this organization');
  return adapter.reconcile(connectionId, apiKey);
}

export { setupState as channelSetupState, ensureConnection as ensureChannelConnection } from '../data/connect';
