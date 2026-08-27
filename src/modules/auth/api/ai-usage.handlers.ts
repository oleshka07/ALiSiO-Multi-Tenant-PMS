/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { aiUsageForMonth } from '@core/ai-usage';
import { todayFor } from '@core/hotel-day';
import { serverError } from '@core/http/errors';

/**
 * GET /api/settings/ai-usage — скільки токенів моделі витратив цей готель.
 *
 * ── Що це і чого це ще не ─────────────────────────────────────────────
 *
 * Це ЛІЧИЛЬНИК, не рахунок. Він показує кількість токенів за місяць і за
 * функцією; ціни тут немає навмисно — вона стане частиною підписки, а
 * підписки в продукті поки немає взагалі. Показати число в грошах раніше, ніж
 * зʼявиться тариф, означало б назвати суму, якої ніхто не погоджував.
 *
 * Коли зʼявиться екран білінгу, ці самі дані переїдуть туди; поки що вони
 * стоять на «Модулі та інтеграції», бо саме там власник дивиться, що його
 * готель споживає.
 *
 * ── Місяць береться в поясі готелю ────────────────────────────────────
 *
 * `todayFor(organizationId)`, а не `new Date()`: сервер живе в UTC, і о 01:30
 * у Празі перше число нового місяця UTC-день ще вчорашній. Підсумок «за
 * серпень», порахований о першій ночі, тоді показав би липень.
 */
export const getAiUsage = withOwner(async (request: Request, _ctx, actor: Actor) => {
  try {
    const asked = new URL(request.url).searchParams.get('month');
    const month = /^\d{4}-\d{2}$/.test(asked || '')
      ? asked!
      : (await todayFor(actor.organizationId)).slice(0, 7);

    return NextResponse.json(await aiUsageForMonth(actor.organizationId, month));
  } catch (e: any) {
    return serverError('modules/auth/api/ai-usage getAiUsage', e);
  }
});
