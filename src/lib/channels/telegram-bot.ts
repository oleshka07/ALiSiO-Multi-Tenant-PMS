/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Telegram Bot Client — sends CRM notifications via existing @kemptimebot
 *
 * DEV/PROD separation:
 *   - Set TELEGRAM_BOT_TOKEN_DEV + TELEGRAM_CHAT_ID_DEV in .env.local to use a
 *     separate bot for local development so prod chats are never polluted.
 *   - If *_DEV vars are absent, the module falls back to the prod bot but
 *     prepends a "[DEV]" tag to every message so you can tell them apart.
 *
 * IMPORTANT: The bot is already running as a Python polling bot.
 * We ONLY use sendMessage/editMessageText API — never getUpdates.
 * Callback queries are handled by polling /api/crm/channels/telegram/poll
 */

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Credentials come from the organization's saved settings first, falling back
 * to the environment. Environment variables are process-global: on a shared
 * server they would hand every tenant the same bot and the same chat.
 *
 * Resolution is lazy and per-call rather than computed at module load, because
 * reading the database during import would trigger migrations from an import.
 *
 * ponytail: takes the only organization, which is correct while the app is
 * single-tenant. Becomes a per-request lookup once tenant context lands.
 */
function resolveConfig(): { botToken: string; chatId: string; adminChatIds: string[] } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDb } = require('@core/db');
    const org = getDb().prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;
    if (org) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getTelegramConfig } = require('@/modules/notifications/data/telegram-config.repo');
      const cfg = getTelegramConfig(org.id);
      if (cfg.botToken) return { botToken: cfg.botToken, chatId: cfg.chatId, adminChatIds: cfg.adminChatIds };
    }
  } catch {
    // Fall through to env — a settings problem must not take notifications down.
  }
  const botToken = IS_DEV
    ? process.env.TELEGRAM_BOT_TOKEN_DEV || process.env.TELEGRAM_BOT_TOKEN || ''
    : process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = IS_DEV
    ? process.env.TELEGRAM_CHAT_ID_DEV || process.env.TELEGRAM_CHAT_ID || ''
    : process.env.TELEGRAM_CHAT_ID || '';
  const adminChatIds = (IS_DEV ? process.env.TELEGRAM_ADMIN_CHAT_IDS_DEV || '' : process.env.TELEGRAM_ADMIN_CHAT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== chatId);
  return { botToken, chatId, adminChatIds };
}

export function getChatId(): string {
  return resolveConfig().chatId;
}

export function getBotToken(): string {
  return resolveConfig().botToken;
}

export function getAdminChatIds(): string[] {
  return resolveConfig().adminChatIds;
}

/** Map draftId → array of { chatId, messageId } for admin copies */
const adminMessageMap = new Map<string, { chatId: string; messageId: number }[]>();

const apiBase = (token: string) => `https://api.telegram.org/bot${token}`;

/** Prepend [DEV] tag when running on dev but using the prod bot as fallback */
function devTag(): string {
  if (!IS_DEV) return '';
  const hasDevBot = !!process.env.TELEGRAM_BOT_TOKEN_DEV;
  return hasDevBot ? '🛠 [DEV] ' : '⚠️ [DEV→PROD BOT] ';
}


interface TelegramResult {
  ok: boolean;
  result?: any;
  description?: string;
}

/* ────────────────────────────────────────────────────────
   Send Message with Inline Keyboard
   ──────────────────────────────────────────────────────── */
export async function sendTelegramMessage(
  text: string,
  inlineKeyboard?: { text: string; callback_data: string }[][],
  options?: { ownerOnly?: boolean },
): Promise<number | null> {
  const { botToken, chatId, adminChatIds } = resolveConfig();
  if (!botToken || !chatId) {
    console.warn('[Telegram] Bot not configured — skipping');
    return null;
  }

  const taggedText = devTag() + text;

  // Send to the primary chat
  const primaryMsgId = await sendToChat(chatId, taggedText, inlineKeyboard);

  // Send copies to admin chats (unless ownerOnly)
  if (!options?.ownerOnly) {
    for (const adminId of adminChatIds) {
      sendToChat(adminId, text, inlineKeyboard).catch(err =>
        console.error(`[Telegram] Admin send to ${adminId} failed:`, err.message)
      );
    }
  }

  return primaryMsgId;
}

/** Low-level: send a message to a specific chat ID */
async function sendToChat(
  chatId: string,
  text: string,
  inlineKeyboard?: { text: string; callback_data: string }[][]
): Promise<number | null> {
  try {
    const body: any = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    };
    if (inlineKeyboard) {
      body.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
    }

    const res = await fetch(`${apiBase(resolveConfig().botToken)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data: TelegramResult = await res.json();
    if (!data.ok) {
      console.error(`[Telegram] sendMessage to ${chatId} failed:`, data.description);
      return null;
    }
    return data.result?.message_id || null;
  } catch (err: any) {
    console.error(`[Telegram] sendMessage to ${chatId} error:`, err.message);
    return null;
  }
}

/* ────────────────────────────────────────────────────────
   Edit Message (update text + keyboard after button press)
   ──────────────────────────────────────────────────────── */
export async function editTelegramMessage(
  messageId: number,
  text: string,
  inlineKeyboard?: { text: string; callback_data: string }[][],
  draftId?: string
): Promise<boolean> {
  const { botToken, chatId } = resolveConfig();
  if (!botToken || !chatId) return false;

  // Edit primary message
  const ok = await editInChat(chatId, messageId, text, inlineKeyboard);

  // Edit admin copies if we have them
  if (draftId) {
    const adminCopies = adminMessageMap.get(draftId) || [];
    for (const copy of adminCopies) {
      editInChat(copy.chatId, copy.messageId, text, inlineKeyboard).catch(err =>
        console.error(`[Telegram] Admin edit in ${copy.chatId} failed:`, err.message)
      );
    }
  }

  return ok;
}

/** Low-level: edit a message in a specific chat */
export async function editInChat(
  chatId: string,
  messageId: number,
  text: string,
  inlineKeyboard?: { text: string; callback_data: string }[][]
): Promise<boolean> {
  try {
    const body: any = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
    };
    if (inlineKeyboard) {
      body.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
    }

    const res = await fetch(`${apiBase(resolveConfig().botToken)}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data: TelegramResult = await res.json();
    if (!data.ok) {
      console.error(`[Telegram] editMessage in ${chatId} failed:`, data.description);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[Telegram] editMessage in ${chatId} error:`, err.message);
    return false;
  }
}

/* ────────────────────────────────────────────────────────
   Answer Callback Query (removes loading spinner on button)
   ──────────────────────────────────────────────────────── */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const { botToken } = resolveConfig();
  if (!botToken) return;
  try {
    await fetch(`${apiBase(botToken)}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || '',
      }),
    });
  } catch { /* non-critical */ }
}

/* ────────────────────────────────────────────────────────
   Send CRM Draft Approval Message
   ──────────────────────────────────────────────────────── */
export async function sendDraftApproval(opts: {
  draftId: string;
  guestName: string;
  guestEmail: string;
  subject: string;
  originalQuery: string;
  proposedResponse: string;
  language: string;
  accountLabel: string;
  confidenceLabel?: string;
}): Promise<number | null> {
  const queryPreview = opts.originalQuery.substring(0, 500);
  const responsePreview = opts.proposedResponse.substring(0, 2000);

  const text = [
    `📩 <b>Новий запит</b> | ${opts.accountLabel}`,
    ...(opts.confidenceLabel ? [`\n${opts.confidenceLabel}\n`] : []),
    ``,
    `👤 <b>${escapeHtml(opts.guestName)}</b> (${escapeHtml(opts.guestEmail)})`,
    `📋 <b>Тема:</b> ${escapeHtml(opts.subject)}`,
    `🌐 <b>Мова:</b> ${opts.language}`,
    ``,
    `━━━ Запит ━━━`,
    `<i>${escapeHtml(queryPreview)}</i>`,
    ``,
    `━━━ Пропоную відповідь (UK) ━━━`,
    escapeHtml(responsePreview),
  ].join('\n');

  const keyboard = [
    [
      { text: '🌍 Перекласти', callback_data: `crm_translate_${opts.draftId}` },
      { text: '✏️ Змінити', callback_data: `crm_edit_${opts.draftId}` },
    ],
    [
      { text: '🇨🇿 CZ', callback_data: `crm_translate_cs_${opts.draftId}` },
      { text: '🇩🇪 DE', callback_data: `crm_translate_de_${opts.draftId}` },
      { text: '🇬🇧 EN', callback_data: `crm_translate_en_${opts.draftId}` },
    ],
    [
      { text: '✅ Відправити як є (UK)', callback_data: `crm_approve_${opts.draftId}` },
      { text: '❌ Відхилити', callback_data: `crm_reject_${opts.draftId}` },
    ],
  ];

  // Send to primary chat
  const { chatId, adminChatIds } = resolveConfig();
  const primaryMsgId = await sendToChat(chatId, text, keyboard);

  // Send to admin chats and track message IDs for later editing
  const adminCopies: { chatId: string; messageId: number }[] = [];
  for (const adminId of adminChatIds) {
    try {
      const adminMsgId = await sendToChat(adminId, text, keyboard);
      if (adminMsgId) {
        adminCopies.push({ chatId: adminId, messageId: adminMsgId });
      }
    } catch (err: any) {
      console.error(`[Telegram] Admin draft send to ${adminId} failed:`, err.message);
    }
  }
  if (adminCopies.length > 0) {
    adminMessageMap.set(opts.draftId, adminCopies);
  }

  return primaryMsgId;
}

/* ────────────────────────────────────────────────────────
   Escape HTML for Telegram
   ──────────────────────────────────────────────────────── */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
