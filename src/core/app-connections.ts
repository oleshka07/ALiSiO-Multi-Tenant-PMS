/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Стан звʼязку із чужою системою — одне місце, `app_connections`.
 *
 * ── Що тут було ─────────────────────────────────────────────────────────
 *
 * Три інтеграції — три різні місця: fiskaly кидав виняток і журналив простій
 * у `fin_fiscal_outages`, пошта лишала `console.log`, менеджер каналів тримав
 * мітки на `cm_connections`. «Чи підключений цей готель до fiskaly ЗАРАЗ» не
 * міг відповісти ніхто — ні екран готелю, ні постачальник.
 *
 * ── Як тепер ────────────────────────────────────────────────────────────
 *
 * Один рядок на (організація, обʼєкт-або-NULL, застосунок): статус, час
 * останнього успіху, час і ТЕКСТ останньої помилки (З7 — готель бачить текст).
 * Пишуть рівно два клієнти: fiskaly (`fiskaly-sign-de.ts`) і пошта
 * (`mail/email.ts`) — по одному місцю в кожному. Менеджер каналів сюди НЕ пише:
 * його стан читається з `cm_connections` (`channelManagerHealth`) і показується
 * тим самим рядком здоровʼя. Журналу викликів (`app_calls`) немає навмисно:
 * у fiskaly є `fin_fiscal_outages`, у каналів — `cm_sends`/`cm_events`.
 *
 * ── Два правила, які тримає гейт `apps.check.ts` ────────────────────────
 *
 * 1. `reportOk`/`reportError` НІКОЛИ не кидають. Стан звʼязку описує операцію
 *    і не має права її зламати: відмова fiskaly, до якої додалась відмова бази,
 *    — це та сама відмова, не дві. Помилка запису йде в `console.error`.
 * 2. Закон: креденшели — організації, підключення — обʼєкту. `scope` у
 *    маніфесті (`apps.ts`) каже, чи рядок має `property_id`: smtp — ніколи
 *    (пошта організації), fiskaly — завжди (TSE стоїть на обʼєкті,
 *    `fin_fiscal_settings.property_id`). Виклик усупереч закону рядка не пише.
 *
 * Орендар — з аргументу, не з контексту: fiskaly і пошта викликаються зсередини
 * запиту, де контекст є, але запис іде в `runWithOrganization(organizationId)`
 * власним зʼєднанням — так рядок лягає під політику навіть із крона чи вебхука,
 * де контексту ще немає (INC-014, той самий клас).
 */
import { getSql } from './db/async.ts';
import { runWithOrganization } from './auth/tenant-context.ts';
import { appById, isAppId, type AppId } from './apps.ts';
import { propertyScopeFilter, type PropertyScope } from './property-scope.ts';

export type ConnectionStatus = 'connected' | 'degraded' | 'error' | 'disabled';

export interface AppConnection {
  id: string;
  organization_id: string;
  property_id: string | null;
  app: string;
  status: ConnectionStatus;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  updated_at: string;
}

/** Текст помилки — обрізаний: колонка не для стек-трейсів, а для людини. */
const ERROR_TEXT_MAX = 500;

function lawAllows(app: AppId, propertyId: string | null): string | null {
  const manifest = appById(app);
  if (!manifest) return `невідомий застосунок «${app}»`;
  if (manifest.scope === 'organization' && propertyId) {
    return `«${app}» підключається на організацію, а рядок називає обʼєкт ${propertyId}`;
  }
  if (manifest.scope === 'property' && !propertyId) {
    return `«${app}» підключається на обʼєкт, а обʼєкта не названо`;
  }
  return null;
}

async function upsert(
  app: string,
  organizationId: string,
  propertyId: string | null,
  patch: { status: ConnectionStatus; ok?: boolean; error?: string },
): Promise<void> {
  try {
    if (!isAppId(app)) {
      console.error(`[app-connections] ${app}: не застосунок із реєстру — стан не записано`);
      return;
    }
    const violation = lawAllows(app, propertyId);
    if (violation) {
      console.error(`[app-connections] ${violation} — стан не записано`);
      return;
    }
    const sql = getSql();
    await runWithOrganization(organizationId, async () => {
      // UPDATE, потім INSERT — а не ON CONFLICT по виразу COALESCE: конфлікт-
      // ціль із виразом читається різними рушіями по-різному, а два запити
      // читаються однаково. Перегони двох одночасних звітів про той самий
      // звʼязок закінчаться унікальним індексом і одним рядком, а не двома.
      const sets = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
      const params: unknown[] = [patch.status];
      if (patch.ok) sets.push('last_ok_at = CURRENT_TIMESTAMP', 'last_error = NULL');
      if (patch.error !== undefined) {
        sets.push('last_error_at = CURRENT_TIMESTAMP', 'last_error = ?');
        params.push(patch.error);
      }
      const updated = await sql.run(
        `UPDATE app_connections SET ${sets.join(', ')}
          WHERE organization_id = ? AND app = ? AND COALESCE(property_id, '') = ?`,
        [...params, organizationId, app, propertyId ?? ''],
      );
      if (updated.changes > 0) return;
      await sql.run(
        `INSERT INTO app_connections (id, organization_id, property_id, app, status, last_ok_at, last_error_at, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ${patch.ok ? 'CURRENT_TIMESTAMP' : 'NULL'}, ${patch.error !== undefined ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, CURRENT_TIMESTAMP)`,
        [
          `appc_${app}_${organizationId}_${propertyId ?? 'org'}`.slice(0, 120),
          organizationId, propertyId, app, patch.status, patch.error ?? null,
        ],
      );
    });
  } catch (e: any) {
    // Правило 1: стан звʼязку не ламає операцію, яку описує.
    console.error(`[app-connections] ${app} @ ${organizationId}: стан не записано —`, e?.message);
  }
}

/** Звернення до вендора вдалося. Ніколи не кидає. */
export async function reportOk(app: AppId | string, organizationId: string, propertyId?: string | null): Promise<void> {
  await upsert(app, organizationId, propertyId ?? null, { status: 'connected', ok: true });
}

/** Звернення до вендора відмовило — з ТЕКСТОМ відмови (З7). Ніколи не кидає. */
export async function reportError(app: AppId | string, organizationId: string, error: unknown, propertyId?: string | null): Promise<void> {
  const text = (error instanceof Error ? error.message : String(error ?? '')).slice(0, ERROR_TEXT_MAX) || 'помилка без тексту';
  await upsert(app, organizationId, propertyId ?? null, { status: 'error', error: text });
}

/**
 * Звʼязки організації — для картки й для здоровʼя. У контексті орендаря.
 *
 * Область обʼєкта — типом (INC-029): картка застосунків показує весь рахунок
 * (`ALL_PROPERTIES`), а звужений читач побачить і рядки організації
 * (`property_id IS NULL` — пошта): підключення на організацію належить
 * кожному її обʼєкту.
 */
export async function listConnections(organizationId: string, scope: PropertyScope): Promise<AppConnection[]> {
  const on = propertyScopeFilter(scope, '');
  return await getSql().rows<AppConnection>(
    `SELECT * FROM app_connections WHERE organization_id = ? AND (${on.sql} OR property_id IS NULL) ORDER BY app, property_id`,
    [organizationId, ...on.params],
  );
}

// ─── Менеджер каналів: стан із cm_connections, без нового запису ──────────

export interface ChannelManagerHealth {
  property_id: string;
  provider: string;
  is_enabled: boolean;
  last_full_sync_at: string | null;
  catalog_synced_at: string | null;
}

/**
 * Менеджер каналів не пише в `app_connections` (не застосунок, З4, і не наша
 * тека). Його стан читається звідти, де він уже є: `cm_connections`. Без
 * нового запису і без правки каналів.
 */
export async function channelManagerHealth(organizationId: string, scope: PropertyScope): Promise<ChannelManagerHealth[]> {
  const on = propertyScopeFilter(scope, '');
  const rows = await getSql().rows<any>(
    `SELECT property_id, provider, is_enabled, last_full_sync_at, catalog_synced_at
       FROM cm_connections WHERE organization_id = ? AND ${on.sql} ORDER BY property_id`,
    [organizationId, ...on.params],
  );
  return rows.map((r) => ({
    property_id: String(r.property_id),
    provider: String(r.provider),
    // 1/0 на SQLite, true/false на Postgres.
    is_enabled: r.is_enabled === true || r.is_enabled === 1,
    last_full_sync_at: r.last_full_sync_at ?? null,
    catalog_synced_at: r.catalog_synced_at ?? null,
  }));
}

// ─── «Хочу» — попит на застосунок, якого ще немає (З2) ───────────────────

/**
 * Ідемпотентно: другий натиск не створює другого рядка і не падає.
 * Застосунок мусить існувати в реєстрі — інакше це не попит, а довільний
 * рядок у таблиці.
 */
export async function wishApp(organizationId: string, app: string): Promise<void> {
  if (!isAppId(app)) throw new Error(`невідомий застосунок «${app}»`);
  const sql = getSql();
  const existing = await sql.row<{ id: string }>(
    'SELECT id FROM app_wishes WHERE organization_id = ? AND app = ?',
    [organizationId, app],
  );
  if (existing) return;
  await sql.run(
    'INSERT INTO app_wishes (id, organization_id, app) VALUES (?, ?, ?)',
    [`wish_${app}_${organizationId}`.slice(0, 120), organizationId, app],
  );
}

/** Які застосунки цей готель уже позначив. Лише свій стан — лічильник у постачальника. */
export async function wishedApps(organizationId: string): Promise<string[]> {
  const rows = await getSql().rows<{ app: string }>(
    'SELECT app FROM app_wishes WHERE organization_id = ? ORDER BY app',
    [organizationId],
  );
  return rows.map((r) => r.app);
}
