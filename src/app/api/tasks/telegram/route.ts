import { NextRequest, NextResponse } from 'next/server';
import { formatUserTasksForTelegram } from '@tasks';
import { getSql } from '@core/db/async';

// GET /api/tasks/telegram?chat_id=123 — returns task list for Telegram user
//
// The bot is the caller, so it authenticates with the same shared secret as
// the other bridge endpoints. A chat_id alone is not a credential: with only
// the middleware's cookie-presence check, any logged-in user could read any
// other user's task list by naming their chat id.
export async function GET(request: NextRequest) {
  try {
    const expected = process.env.TELEGRAM_BRIDGE_TOKEN;
    if (!expected) {
      return NextResponse.json({ error: 'Bridge not configured: TELEGRAM_BRIDGE_TOKEN missing on server' }, { status: 503 });
    }
    if (request.headers.get('authorization') !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const chatId = request.nextUrl.searchParams.get('chat_id');
    if (!chatId) {
      return NextResponse.json({ error: 'chat_id required' }, { status: 400 });
    }

    const sql = getSql();
    const user = await sql.row<{ id: string }>(
      "SELECT id FROM app_users WHERE telegram_chat_id = ? AND is_active = 1",
      [chatId]
    );

    if (!user) {
      return NextResponse.json({
        text: '❌ Ваш Telegram не прив\'язаний до жодного користувача PMS. Зверніться до адміністратора.',
      });
    }

    const text = await formatUserTasksForTelegram(user.id);
    return NextResponse.json({ text });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}
