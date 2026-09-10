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
import { integrationCredentials, integrationStatus, seal, type IntegrationChannel, type IntegrationStatus } from '@core/integration-credentials';
import { secretsConfigured } from '@core/security/secrets';
import { getSql } from '@core/db/async';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';
import { probeMail } from '@core/mail/email';
import { fiskalyConnect } from '@/modules/invoicing/data/fiskaly-sign-de';
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

/** Обʼєкт готелю і чи має він TSS — для картки fiskaly (3.8). */
export interface FiscalProperty {
  property_id: string;
  name: string;
  /** Останні чотири символи `tss_id`; `null` — TSS не підключено. */
  tss: string | null;
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
  // Екран застосунків — про РАХУНОК: підключення TSE кожного обʼєкта і
  // пошта організації в одному списку здоровʼя; область обʼєкта тут навмисно
  // «усі» (INC-029), і це написано словом.
  const [connections, wished, cm] = await Promise.all([
    listConnections(org, ALL_PROPERTIES),
    wishedApps(org),
    channelManagerHealth(org, ALL_PROPERTIES),
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

  // Картка fiskaly: обʼєкти і чи підключено TSS на кожному. Ідентифікатори,
  // не секрети — last4, як ключі.
  const sql = getSql();
  const props = await sql.rows<{ id: string; name: string }>('SELECT id, name FROM properties WHERE organization_id = ? ORDER BY created_at, id', [org]);
  const everyProperty = propertyScopeFilter(ALL_PROPERTIES, '');
  const settings = await sql.rows<{ property_id: string; tss_id: string | null }>(
    `SELECT property_id, tss_id FROM fin_fiscal_settings WHERE organization_id = ? AND ${everyProperty.sql}`, [org, ...everyProperty.params]);
  const fiscalProperties: FiscalProperty[] = props.map((p) => {
    const tss = settings.find((s) => s.property_id === p.id)?.tss_id ?? null;
    return { property_id: String(p.id), name: String(p.name), tss: tss ? `…${tss.slice(-4)}` : null };
  });

  return NextResponse.json({ cards, health, fiscalProperties });
});

/**
 * POST /api/settings/apps/fiskaly/connect { propertyId } — «Підключити TSE» (3.8).
 *
 * Картка з полями ключів без способу отримати TSS — перемикач-обманка (П5):
 * `fin_fiscal_settings` досі не писав ніхто в продукті. Тут — кроки 2–3
 * quickstart через `fiskalyConnect`, а потім рядок обʼєкта: ідентифікатори
 * відкрито, PIN/PUK під `seal()` (З17). `serial_number` =
 * `recording_system_serial` = `ALISIO-<slug обʼєкта>` — те, що §6 KassenSichV
 * друкує на белезі.
 *
 * Ідемпотентно в бік ВІДМОВИ: обʼєкт із заповненим `tss_id` дістає 409 з
 * назвою, а не другу TSS — кожна коштує грошей.
 */
export const connectFiskaly = withOwner(async (request: Request, _ctx, actor: Actor) => {
  const org = actor.organizationId;
  const body = await request.json().catch(() => ({}));
  const propertyId = typeof body?.propertyId === 'string' ? body.propertyId : '';
  if (!propertyId) return NextResponse.json({ error: 'Потрібно: propertyId' }, { status: 400 });
  if (!(await hasFeature(org, 'fiscal_de'))) {
    return NextResponse.json({ error: 'Спочатку увімкніть фіскалізацію' }, { status: 409 });
  }
  const creds = await integrationCredentials('fiskaly', org);
  if (!creds?.clientId || !creds.clientSecret) {
    return NextResponse.json({ error: 'Спочатку збережіть ключі fiskaly' }, { status: 409 });
  }
  return connectTseForProperty(org, propertyId, { apiKey: creds.clientId, apiSecret: creds.clientSecret });
});

/**
 * Тіло «Підключити TSE» без варти й без запиту — щоб гейт `apps.check.ts`
 * міг пройти його проти підставленого HTTP fiskaly. Орендар — з аргументу,
 * і кожен запит його називає; викликається лише з `connectFiskaly` (варта
 * `withOwner`) і з гейта.
 */
export async function connectTseForProperty(
  org: string,
  propertyId: string,
  creds: { apiKey: string; apiSecret: string },
): Promise<Response> {
  if (!secretsConfigured()) {
    return NextResponse.json({ error: 'APP_SECRET_KEY не налаштовано на сервері — PIN TSS нема куди зашифрувати' }, { status: 503 });
  }
  const sql = getSql();
  const property = await sql.row<{ id: string; slug: string }>('SELECT id, slug FROM properties WHERE id = ? AND organization_id = ?', [propertyId, org]);
  if (!property) return NextResponse.json({ error: 'Не знайдено' }, { status: 404 });
  const existing = await sql.row<{ id: string; tss_id: string | null }>('SELECT id, tss_id FROM fin_fiscal_settings WHERE property_id = ? AND organization_id = ?', [propertyId, org]);
  if (existing?.tss_id) {
    return NextResponse.json({ error: `TSS уже підключено до цього обʼєкта: …${existing.tss_id.slice(-4)}` }, { status: 409 });
  }

  const serialNumber = `ALISIO-${String(property.slug)}`;
  let tss;
  try {
    tss = await fiskalyConnect(creds, { propertyId, serialNumber });
  } catch (e) {
    // Відмова вендора вже лежить у app_connections із текстом (reported()) —
    // її і показує картка. Клієнту — рід відмови, не e.message (інваріант 6).
    console.error(`[apps] fiskaly connect @ ${org}/${propertyId}:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'fiskaly відмовив — текст на картці застосунку' }, { status: 502 });
  }

  const pin = seal(tss.adminPin);
  const puk = seal(tss.adminPuk);
  if (existing) {
    await sql.run(
      `UPDATE fin_fiscal_settings SET tss_id = ?, tse_client_id = ?, recording_system_serial = ?, tse_admin_pin = ?, tse_admin_puk = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`,
      [tss.tssId, tss.clientId, serialNumber, pin, puk, existing.id, org]);
  } else {
    await sql.run(
      `INSERT INTO fin_fiscal_settings (id, organization_id, property_id, tss_id, tse_client_id, recording_system_serial, tse_admin_pin, tse_admin_puk)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`fs_${propertyId}`.slice(0, 60), org, propertyId, tss.tssId, tss.clientId, serialNumber, pin, puk]);
  }
  return NextResponse.json({ connected: true, propertyId, tss: `…${tss.tssId.slice(-4)}`, serialNumber });
}

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
  const rows = (await listConnections(org, ALL_PROPERTIES)).filter((c) => c.app === id);
  return NextResponse.json({ app: id, connections: rows });
});
