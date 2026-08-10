/**
 * Notification settings — Telegram connection and per-event toggles.
 *
 * Everything is scoped to the caller's organization taken from the session,
 * never from the request body: a tenant must not be able to read or overwrite
 * another tenant's bot credentials by passing someone else's id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionUser } from '@core/auth';
import { withActor, withPermission } from '@core/auth/session';
import {
  DEFAULT_EVENTS,
  disconnectTelegram,
  getTelegramConfig,
  getTelegramConfigPublic,
  saveTelegramConfig,
  type TelegramEvents,
} from '../data/telegram-config.repo';

async function currentUser() {
  const store = await cookies();
  return await getSessionUser(store.get('session_id')?.value);
}

const unauthorized = () => NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
const forbidden = () => NextResponse.json({ error: 'Недостатньо прав' }, { status: 403 });

/** Only an owner may see or change integration credentials. */
function canManage(role: string): boolean {
  return role === 'owner' || role === 'director';
}

export const getNotificationSettings = withActor(async (): Promise<NextResponse> => {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!canManage(user.role)) return forbidden();
  try {
    return NextResponse.json(await getTelegramConfigPublic(user.organization_id));
  } catch (e: any) {
    console.error('GET /api/settings/notifications error:', e);
    return NextResponse.json({ error: 'Не вдалося прочитати налаштування' }, { status: 500 });
  }
});

function coerceEvents(raw: unknown): TelegramEvents {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_EVENTS };
  for (const key of Object.keys(DEFAULT_EVENTS) as (keyof TelegramEvents)[]) {
    if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
  }
  return out;
}

export const saveNotificationSettings = withPermission('manage_properties', async (request: NextRequest): Promise<NextResponse> => {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!canManage(user.role)) return forbidden();
  try {
    const body = await request.json();
    const chatId = String(body.chatId ?? '').trim();
    const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';

    if (botToken && !/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
      return NextResponse.json(
        { error: 'Токен виглядає некоректно. Формат: 123456789:ABCdef… — візьміть його у @BotFather' },
        { status: 400 },
      );
    }
    if (chatId && !/^-?\d+$/.test(chatId)) {
      return NextResponse.json({ error: 'Chat ID має бути числом, напр. -1001234567890' }, { status: 400 });
    }

    const adminChatIds = Array.isArray(body.adminChatIds)
      ? body.adminChatIds.map((v: unknown) => String(v).trim()).filter(Boolean)
      : String(body.adminChatIds ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    const bad = adminChatIds.find((id: string) => !/^-?\d+$/.test(id));
    if (bad) return NextResponse.json({ error: `Некоректний Chat ID адміністратора: ${bad}` }, { status: 400 });

    await saveTelegramConfig(user.organization_id, {
      botToken: botToken || undefined,
      chatId,
      adminChatIds,
      events: coerceEvents(body.events),
    });
    return NextResponse.json(await getTelegramConfigPublic(user.organization_id));
  } catch (e: any) {
    console.error('PUT /api/settings/notifications error:', e);
    return NextResponse.json({ error: e?.message || 'Не вдалося зберегти' }, { status: 500 });
  }
});

export const deleteNotificationSettings = withPermission('manage_properties', async (): Promise<NextResponse> => {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!canManage(user.role)) return forbidden();
  try {
    await disconnectTelegram(user.organization_id);
    return NextResponse.json(await getTelegramConfigPublic(user.organization_id));
  } catch (e: any) {
    console.error('DELETE /api/settings/notifications error:', e);
    return NextResponse.json({ error: 'Не вдалося відключити' }, { status: 500 });
  }
});

/**
 * Verify the stored credentials against Telegram and, when a chat is set, send
 * a real message — getMe alone proves the token works but not that the bot can
 * actually reach the chat, which is the failure people actually hit.
 */
export const testNotificationSettings = withPermission('manage_properties', async (): Promise<NextResponse> => {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!canManage(user.role)) return forbidden();

  const cfg = await getTelegramConfig(user.organization_id);
  if (!cfg.botToken) {
    return NextResponse.json({ ok: false, error: 'Токен не збережено' }, { status: 400 });
  }

  try {
    const meRes = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`);
    const me = (await meRes.json()) as { ok: boolean; result?: { username?: string }; description?: string };
    if (!me.ok) {
      return NextResponse.json({ ok: false, error: me.description || 'Telegram відхилив токен' }, { status: 400 });
    }

    if (!cfg.chatId) {
      return NextResponse.json({
        ok: true,
        bot: me.result?.username,
        warning: 'Бот працює, але Chat ID не вказано — повідомлення нікуди не надсилатимуться.',
      });
    }

    const sendRes = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text: '✅ ALiSiO ERP — тестове повідомлення. Сповіщення налаштовано правильно.',
      }),
    });
    const sent = (await sendRes.json()) as { ok: boolean; description?: string };
    if (!sent.ok) {
      return NextResponse.json(
        { ok: false, bot: me.result?.username, error: `Бот працює, але не може писати в чат: ${sent.description}` },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, bot: me.result?.username, sent: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Не вдалося звʼязатися з Telegram: ${e.message}` }, { status: 502 });
  }
});
