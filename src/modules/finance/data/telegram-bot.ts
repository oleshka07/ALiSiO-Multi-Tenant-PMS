/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Minimal Telegram Bot integration for investor notifications.
//
// The bot token is read from the TELEGRAM_BOT_TOKEN environment variable
// (set on prod via PM2 ecosystem.config or .env). To set it up:
//   1. Talk to @BotFather on Telegram, /newbot, get the token
//   2. Add `TELEGRAM_BOT_TOKEN=12345:abc...` to .env on prod
//   3. Restart the Next.js server
//   4. Each investor needs to start a chat with the bot and obtain
//      their numeric chat_id (e.g. via @userinfobot or @getmyid_bot),
//      which the admin pastes into the investor's telegram_chat_id field.
//
// We use the bare HTTPS API (no SDK) — the only methods we need are
// `getMe` (status check) and `sendMessage`. No webhooks, no inline state.
//

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function getTelegramBotInfo(): Promise<{ ok: boolean; username?: string; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = await res.json() as any;
    if (!json.ok) return { ok: false, error: json.description || 'Telegram API error' };
    return { ok: true, username: json.result?.username };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set on server' };
  if (!chatId) return { ok: false, error: 'Missing chat_id' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    const json = await res.json() as any;
    if (!json.ok) return { ok: false, error: json.description || 'Telegram send failed' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
