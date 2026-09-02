import crypto from 'node:crypto';
import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { integrationStatus } from '@core/integration-credentials';
import { connectionInTenant, connectionsForProperty, type Connection } from './connections.repo';

/**
 * Майстер підключення — стан і кроки, з боку даних.
 *
 *   node src/modules/channels/data/connect.check.ts
 *
 * ── Стан не зберігається, а виводиться ─────────────────────────────────
 *
 * Готельєр закриє вкладку посеред процесу — це норма, не виняток. Тому в
 * майстра немає власної таблиці «на якому кроці»: крок читається з того, що
 * вже записано — ключ у облікових даних організації, рядок `cm_connections`,
 * `remote_property_id` після каталогу, `is_enabled` наприкінці. Кожен крок
 * або завершений і записаний, або його ніби не було; повторний вхід
 * продовжує і не створює других сутностей у чужому акаунті.
 *
 * ── Ключ — у кожного готелю свій, і майстер не знає, звідки він ──────────
 *
 * Ключ завжди приходить з облікових даних організації (Р9), незалежно від
 * того, чиї пальці його набрали: «готель приніс свій» і «ми завели акаунт і
 * вписали за нього» — один шлях коду. Радіус вибуху — один готель; один
 * спільний акаунт означав би, що помилка мапінгу відправить ціни готелю А
 * на обʼєкт готелю Б, і жоден RLS цього не спіймає — на тому боці RLS немає
 * (інваріант 25 на проді). Стан майстра несе лише НАЯВНІСТЬ ключа, ніколи
 * значення.
 */

export type SetupStep = 'key' | 'connection' | 'catalog' | 'mapping' | 'done';

export interface SetupState {
  /** Обʼєкт, як його бачить орендар; `null` — чужий або неіснуючий. */
  property: { id: string; name: string } | null;
  hasKey: boolean;
  /** Натяк на значення від облікових даних — ніколи саме значення. */
  keyHint: string | null;
  connection: Connection | null;
  /** Вебхук у вендора зареєстровано (`remote_webhook_id`). Без нього бронь чекає на крон (Ц20). */
  webhookRegistered: boolean;
  step: SetupStep;
}

/** На якому кроці майстер — з того, що записано. */
export async function setupState(propertyId: string): Promise<SetupState> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('connect: read without a tenant');

  const sql = getSql();
  // Чужий і неіснуючий обʼєкт однакові — 404, не 403 (інваріант 5).
  const property = await sql.row<any>(
    'SELECT id, name FROM properties WHERE id = ? AND organization_id = ?', [propertyId, organizationId],
  );
  if (!property) return { property: null, hasKey: false, keyHint: null, connection: null, webhookRegistered: false, step: 'key' };

  const status = await integrationStatus('channel_manager', organizationId);
  const hasKey = status.configured;
  const keyHint = hasKey ? (status.values.accessToken ?? null) : null;

  // Одне зʼєднання на обʼєкт у майстра: перше, що є. Кілька середовищ на
  // один обʼєкт — справа розробки, не готельєра.
  const connection = (await connectionsForProperty(propertyId))[0] ?? null;

  let step: SetupStep = 'key';
  if (hasKey) step = 'connection';
  if (hasKey && connection) step = connection.remotePropertyId ? 'mapping' : 'catalog';
  if (hasKey && connection?.remotePropertyId && connection.isEnabled) step = 'done';

  return { property: { id: String(property.id), name: String(property.name) }, hasKey, keyHint, connection, webhookRegistered: !!connection?.remoteWebhookId, step };
}

/**
 * Зʼєднання для обʼєкта — рівно одне, скільки б разів не заходили.
 *
 * `UNIQUE(organization_id, property_id, provider, environment)` тримає
 * схема; тут лише «створи, якщо немає, і поверни те, що є». Вебхук-токен і
 * секрет куються одразу: без них рядок не лягає (NOT NULL), а вебхук фази
 * 5 читатиме саме їх.
 */
export async function ensureConnection(input: {
  propertyId: string;
  provider: string;
  environment: 'staging' | 'production';
}): Promise<Connection> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('connect: write without a tenant');

  const sql = getSql();
  const owned = await sql.row<any>(
    'SELECT id FROM properties WHERE id = ? AND organization_id = ?', [input.propertyId, organizationId],
  );
  if (!owned) throw new Error('connect: property not found');

  const existing = (await connectionsForProperty(input.propertyId))
    .find((c) => c.provider === input.provider && c.environment === input.environment);
  if (existing) return existing;

  const id = `cmc_${crypto.randomBytes(8).toString('hex')}`;
  await sql.run(
    `INSERT INTO cm_connections
       (id, organization_id, property_id, provider, environment, webhook_token, webhook_secret, is_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)
     ON CONFLICT (organization_id, property_id, provider, environment) DO NOTHING`,
    [id, organizationId, input.propertyId, input.provider, input.environment,
      crypto.randomBytes(24).toString('hex'), crypto.randomBytes(32).toString('hex')],
  );

  const made = (await connectionsForProperty(input.propertyId))
    .find((c) => c.provider === input.provider && c.environment === input.environment);
  if (!made) throw new Error('connect: connection was not created');
  return made;
}

/** Увімкнути або вимкнути розсилку. Чуже — 404, не 403. */
export async function setConnectionEnabled(connectionId: string, enabled: boolean): Promise<Connection> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('connect: write without a tenant');

  const current = await connectionInTenant(connectionId);
  if (!current) throw new Error('connect: connection not found');

  const sql = getSql();
  await sql.run(
    `UPDATE cm_connections SET is_enabled = ${enabled ? 'TRUE' : 'FALSE'}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`,
    [connectionId, organizationId],
  );
  const after = await connectionInTenant(connectionId);
  if (!after) throw new Error('connect: connection not found');
  return after;
}

/** Обʼєкти орендаря — для вибору в майстрі. Орендар — із сесії. */
export async function propertiesInTenant(): Promise<{ id: string; name: string }[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('connect: read without a tenant');
  const rows = await getSql().rows<any>(
    'SELECT id, name FROM properties WHERE organization_id = ? ORDER BY name', [organizationId],
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}
