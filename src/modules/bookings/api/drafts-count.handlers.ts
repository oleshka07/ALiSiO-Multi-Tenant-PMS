import { NextResponse } from 'next/server';
import { withActor, type Actor } from '@core/auth/session';
import { requestPropertyScope } from '@core/auth/property-scope';
import { handleError } from '@core/http/errors';
import { countDraftsOf } from '../data/lists.repo';

/**
 * Скільки чернеток чекає — число для бейджа на календарі й у бічному меню.
 *
 * Маршрут сидить під публічним префіксом `/api/booking/` (той існує для
 * гостьового віджета) і колись не мав ні перевірки сесії, ні орендаря: рахував
 * чернетки всіх готелів і відповідав будь-кому. Тепер — `withActor`, і його
 * єдині викликачі (календар і бічне меню) сесію мають завжди.
 *
 * ── Чому тут вісь обʼєкта ───────────────────────────────────────────────
 *
 * Бейдж клікабельний, і клік веде на `/app/bookings?status=draft`. Щойно той
 * список узяв `PropertyScope` (INC-029), бейдж без осі почав казати «5» там, де
 * сторінка показує «2»: число, за яким іде людина, і число, яке вона бачить,
 * розійшлись. Тому область береться тими самими дверима й тим самим порядком
 * (адреса → кука → єдиний обʼєкт → усі), а сам запит живе поруч зі списком, з
 * яким мусить збігатися, — `data/lists.repo.ts`.
 *
 * Одна різниця лишається навмисно: бейдж не рахує фальшивих броней iCal
 * («OTA block»), а сторінка їх показує. Це названий виняток, і сцена
 * `data/drafts-badge.check.ts` тримає його окремим числом.
 */
export const draftsCount = withActor(async (request: Request, _ctx, actor: Actor) => {
  try {
    const scope = await requestPropertyScope(request, actor.organizationId);
    return NextResponse.json({ count: await countDraftsOf(actor.organizationId, scope) });
  } catch (e: unknown) {
    // Названа відмова їде своїм статусом: чужий `property_id` — 404, не 500
    // (інваріанти 5 і 6).
    return handleError('modules/bookings/api/drafts-count', e);
  }
});
