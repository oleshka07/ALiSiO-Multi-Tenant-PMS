/**
 * Дублікати гостя в руках портьє: подивитись, злити або сказати «різні» (INC-304).
 *
 * Шукач кандидатів існував лише для коду (імпорту). Дублікати ж робить портьє,
 * щодня, у будь-якому готелі — і без цих маршрутів жоден живий користувач їх
 * не бачить.
 *
 * ── Право, а не просто сесія ────────────────────────────────────────────
 *
 * Злиття незворотне і переносить брони, реєстрації та згоди, тож маршрути
 * стоять під `manage_guests`, а не під `withActor`: показати список дублікатів
 * означає показати поруч дві картки з іменами, документами й контактами.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { handleError } from '@core/http/errors';
import { refuse } from '@core/http/refusal';
import { guestDuplicateCandidates } from '../data/guest-duplicates.repo';
import { mergeGuests, previewMerge, markNotDuplicates } from '../data/guest-merge.repo';
import { listGuests } from '../data/guests.repo';

/** Пари з назвою причини і достатньо даних, щоб людина побачила, кого зливає. */
export const listDuplicates = withPermission('manage_guests', async (
  _request: NextRequest, _ctx, actor: Actor,
) => {
  try {
    const pairs = await guestDuplicateCandidates(actor.organizationId);
    if (pairs.length === 0) return NextResponse.json({ pairs: [] });

    // Картки обох боків — одним читанням списку, а не запитом на кожного:
    // на 35 тисячах гостей другий варіант дав би тисячі запитів.
    const wanted = new Set(pairs.flatMap((p) => [p.keepId, p.dropId]));
    const { data } = await listGuests(actor.organizationId, {}, 1, 5000);
    const byId = new Map((data as { id: string }[]).filter((g) => wanted.has(g.id)).map((g) => [g.id, g]));

    return NextResponse.json({
      pairs: pairs.map((p) => ({
        ...p, left: byId.get(p.keepId) ?? null, right: byId.get(p.dropId) ?? null,
      })).filter((p) => p.left && p.right),
    });
  } catch (error) {
    return handleError('modules/guests/api/duplicates listDuplicates', error);
  }
});

/** Що САМЕ переїде — до натискання, не після. */
export const previewDuplicateMerge = withPermission('manage_guests', async (
  request: NextRequest, _ctx, actor: Actor,
) => {
  try {
    const body = await request.json().catch(() => ({}));
    const keepId = String(body.keepId || '');
    const dropId = String(body.dropId || '');
    if (!keepId || !dropId) refuse('Не названо, кого лишаємо і кого зливаємо', 400);

    return NextResponse.json({
      moves: await previewMerge({ organizationId: actor.organizationId, keepId, dropId }),
    });
  } catch (error) {
    return handleError('modules/guests/api/duplicates previewDuplicateMerge', error);
  }
});

/**
 * Рішення людини: «це та сама людина» або «це різні люди».
 *
 * Один маршрут на обидва, бо це одна дія оператора з двома відповідями, і
 * розділені вони розійшлися б у правах.
 *
 * `keepId` приходить із запиту, а не обирається кодом: «лишаємо старшого»
 * здається очевидним і неправильне — у старшого може не бути документа.
 */
export const decideDuplicate = withPermission('manage_guests', async (
  request: NextRequest, _ctx, actor: Actor,
) => {
  try {
    const body = await request.json().catch(() => ({}));
    const decision = String(body.decision || '');
    const keepId = String(body.keepId || '');
    const dropId = String(body.dropId || '');
    if (!keepId || !dropId) refuse('Не названо пари', 400);

    if (decision === 'same') {
      const result = await mergeGuests({
        organizationId: actor.organizationId, keepId, dropId, decidedBy: actor.user.id,
      });
      return NextResponse.json(result);
    }
    if (decision === 'different') {
      await markNotDuplicates({
        organizationId: actor.organizationId, guestA: keepId, guestB: dropId,
        decidedBy: actor.user.id, note: body.note ? String(body.note) : null,
      });
      return NextResponse.json({ ok: true });
    }
    refuse('Невідоме рішення: буває «same» або «different»', 400);
  } catch (error) {
    return handleError('modules/guests/api/duplicates decideDuplicate', error);
  }
});
