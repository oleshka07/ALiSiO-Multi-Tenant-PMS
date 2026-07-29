/**
 * Per-tenant Telegram configuration.
 *
 * Lives in crm_channels (channel_type='telegram'), which is already scoped by
 * organization_id — unlike the TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
 * environment variables it replaces. Env vars are process-global, so on a
 * shared server every tenant would have shared one bot and one chat.
 *
 * Env is still read as a fallback so an existing single-tenant deployment keeps
 * working until its owner saves the settings once.
 */
import { getDb } from '@core/db';
import { decryptSecret, encryptSecret, secretsConfigured } from '@core/security/secrets';

export interface TelegramConfig {
  /** Decrypted bot token — never send this to the browser. */
  botToken: string;
  chatId: string;
  adminChatIds: string[];
  events: TelegramEvents;
  /** Where the values came from, so the UI can say "still using env". */
  source: 'db' | 'env' | 'none';
}

export interface TelegramEvents {
  newBooking: boolean;
  cancellation: boolean;
  guestRegistration: boolean;
  payment: boolean;
  dailyDigest: boolean;
  taskAssigned: boolean;
}

export const DEFAULT_EVENTS: TelegramEvents = {
  newBooking: true,
  cancellation: true,
  guestRegistration: true,
  payment: true,
  dailyDigest: true,
  taskAssigned: false,
};

const CHANNEL_TYPE = 'telegram';

function parseIds(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function envConfig(): Omit<TelegramConfig, 'source'> | null {
  const isDev = process.env.NODE_ENV === 'development';
  const botToken = isDev
    ? process.env.TELEGRAM_BOT_TOKEN_DEV || process.env.TELEGRAM_BOT_TOKEN || ''
    : process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = isDev
    ? process.env.TELEGRAM_CHAT_ID_DEV || process.env.TELEGRAM_CHAT_ID || ''
    : process.env.TELEGRAM_CHAT_ID || '';
  if (!botToken) return null;
  const adminChatIds = parseIds(
    isDev ? process.env.TELEGRAM_ADMIN_CHAT_IDS_DEV : process.env.TELEGRAM_ADMIN_CHAT_IDS,
  ).filter((id) => id !== chatId);
  return { botToken, chatId, adminChatIds, events: DEFAULT_EVENTS };
}

/** Resolve the effective config for one organization. */
export function getTelegramConfig(organizationId: string): TelegramConfig {
  try {
    const row = getDb()
      .prepare('SELECT config_json FROM crm_channels WHERE organization_id = ? AND channel_type = ? LIMIT 1')
      .get(organizationId, CHANNEL_TYPE) as { config_json: string | null } | undefined;

    if (row?.config_json) {
      const cfg = JSON.parse(row.config_json) as {
        botTokenEnc?: string;
        chatId?: string;
        adminChatIds?: string[];
        events?: Partial<TelegramEvents>;
      };
      if (cfg.botTokenEnc && secretsConfigured()) {
        return {
          botToken: decryptSecret(cfg.botTokenEnc),
          chatId: cfg.chatId ?? '',
          adminChatIds: (cfg.adminChatIds ?? []).filter((id) => id !== cfg.chatId),
          events: { ...DEFAULT_EVENTS, ...(cfg.events ?? {}) },
          source: 'db',
        };
      }
    }
  } catch {
    // Fall through to env — a malformed row must not take notifications down.
  }

  const env = envConfig();
  if (env) return { ...env, source: 'env' };
  return { botToken: '', chatId: '', adminChatIds: [], events: DEFAULT_EVENTS, source: 'none' };
}

/** Shape safe to send to the browser: the token is replaced by a "is it set" flag. */
export function getTelegramConfigPublic(organizationId: string) {
  const cfg = getTelegramConfig(organizationId);
  return {
    hasToken: !!cfg.botToken,
    chatId: cfg.chatId,
    adminChatIds: cfg.adminChatIds,
    events: cfg.events,
    source: cfg.source,
    secretsConfigured: secretsConfigured(),
  };
}

export interface SaveTelegramInput {
  /** Omit or leave empty to keep the stored token unchanged. */
  botToken?: string;
  chatId: string;
  adminChatIds: string[];
  events: TelegramEvents;
}

export function saveTelegramConfig(organizationId: string, input: SaveTelegramInput): void {
  const db = getDb();
  const row = db
    .prepare('SELECT id, config_json FROM crm_channels WHERE organization_id = ? AND channel_type = ? LIMIT 1')
    .get(organizationId, CHANNEL_TYPE) as { id: string; config_json: string | null } | undefined;

  const existing = row?.config_json ? (JSON.parse(row.config_json) as { botTokenEnc?: string }) : {};
  const botTokenEnc = input.botToken
    ? encryptSecret(input.botToken.trim())
    : existing.botTokenEnc;

  const config = JSON.stringify({
    botTokenEnc,
    chatId: input.chatId.trim(),
    adminChatIds: input.adminChatIds.map((s) => s.trim()).filter(Boolean),
    events: input.events,
  });

  if (row) {
    db.prepare('UPDATE crm_channels SET config_json = ?, is_active = 1 WHERE id = ?').run(config, row.id);
  } else {
    db.prepare(
      'INSERT INTO crm_channels (id, organization_id, channel_type, name, config_json, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    ).run(`ch_telegram_${organizationId}`, organizationId, CHANNEL_TYPE, 'Telegram Bot', config);
  }
}

/** Forget the stored credentials for this organization. */
export function disconnectTelegram(organizationId: string): void {
  getDb()
    .prepare('UPDATE crm_channels SET config_json = NULL, is_active = 0 WHERE organization_id = ? AND channel_type = ?')
    .run(organizationId, CHANNEL_TYPE);
}
