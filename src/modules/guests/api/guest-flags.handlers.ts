/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { handleError } from '@core/http/errors';
import { setVip, blacklistGuest, unblacklistGuest } from '../data/guest-flags.repo';

/**
 * VIP і чорний список — окремий маршрут, а не поля в PATCH картки.
 *
 * ── Чому окремо ─────────────────────────────────────────────────────────
 *
 * Форма картки шле `{...form}` цілком при кожному збереженні. Якби прапорці
 * їхали там, «зберегти адресу» несло б із собою й стан блокування — тобто
 * будь-яке редагування переставляло б ознаку, яка вирішує, чи пустять людину
 * в готель. Це той самий клас, що `property_type: ''` у формі обʼєкта
 * (`property-lodging-kind.check`), лише дорожчий: там зникав рід житла, тут
 * зникла б причина відмови живій людині.
 *
 * Автор блокування — з СЕСІЇ, ніколи з тіла: підпис, який може надіслати
 * клієнт, не є підписом.
 *
 * `handleError` у `catch`, а не голий 500: писач кидає НАЗВАНУ відмову, коли
 * причини блокування немає, і саме її текст має побачити портьє (інваріант 6).
 */
type IdParams = { params: Promise<{ id: string }> };

export const setGuestFlags = withPermission('manage_guests', async (request: NextRequest, { params }: IdParams, actor: Actor) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as {
      is_vip?: unknown; blacklisted?: unknown; blacklist_reason?: unknown;
    };

    let touched = false;
    let found = true;

    if (typeof body.is_vip === 'boolean') {
      found = await setVip(actor.organizationId, id, body.is_vip);
      touched = true;
    }

    if (found && typeof body.blacklisted === 'boolean') {
      found = body.blacklisted
        ? await blacklistGuest({
          organizationId: actor.organizationId, guestId: id,
          reason: typeof body.blacklist_reason === 'string' ? body.blacklist_reason : '',
          // Ідентифікатор особи із сесії — не імʼя: імена змінюються, а
          // підпис під відмовою має лишатись розвʼязним через рік.
          by: actor.user?.id ?? actor.organizationId,
        })
        : await unblacklistGuest(actor.organizationId, id);
      touched = true;
    }

    // Порожнє тіло — це не «нічого не сталося», це запит, який нічого не
    // просить. Відповідати 200 означало б підтвердити зміну, якої не було.
    if (!touched) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleError('PATCH /api/guests/[id]/flags', error, 'Failed to update guest flags');
  }
});
