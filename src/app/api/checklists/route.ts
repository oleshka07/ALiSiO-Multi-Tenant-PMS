import { NextRequest, NextResponse } from 'next/server';
import { dirtyUnitsForShift } from '@properties';
import { requestPropertyScope } from '@core/auth/property-scope';
import { withActor, type Actor } from '@core/auth/session';
import { handleError } from '@core/http/errors';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Shift checklists for the mobile app.
 *
 * What was here answered 500 on every call: it read a `bookings` table that
 * does not exist in this schema — the table is `reservations` — so
 * MobileShiftChecklists has shown nothing since the code arrived.
 *
 * The checklists themselves were not a bug to patch. All of them were written
 * out in full for one hotel: a sauna inspection triggered by units or notes
 * containing one word, and a daily round of two of its buildings by name.
 * Neither means anything to a second customer, and shipping them would put
 * another hotel's vocabulary on every screen. So this returns the part that is
 * genuinely general — which rooms need cleaning — and no checklists until they
 * are something an organization defines. A `checklists` table with per-item
 * rules is the actual feature, and it is not this change.
 */
export const GET = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    // Який ОБʼЄКТ, а не лише який орендар.
    //
    // Тут раніше стояв запит із коментарем «Scoped: unqualified this listed
    // every hotel's dirty rooms» — і він правдивий рівно наполовину: чужий
    // РАХУНОК справді не видно, а сусідній ОБʼЄКТ того самого рахунку видно
    // повністю. Покоївка другого будинку відкривала свій чекліст і бачила
    // кімнати першого. Перший підтверджений випадок класу «вісь орендаря,
    // вдягнена як вісь обʼєкта» (INC-029, звуження означення 09.09.2026).
    //
    // SQL пішов у `properties/data/cleaning.repo.ts`, де вже живуть усі
    // читачі стану прибирання: маршрут не пише SQL до `units`, він питає
    // фасад — так само, як housekeeping.
    const scope = await requestPropertyScope(request, actor.organizationId);
    const dirtyUnits = await dirtyUnitsForShift(actor.organizationId, scope);

    return NextResponse.json({
      success: true,
      dirtyUnitsCount: dirtyUnits.length,
      dirtyUnits,
      checklists: [],
    });
  } catch (error: unknown) {
    // Чужий обʼєкт у параметрі — названа відмова 404; решта — 500 із логом.
    return handleError('checklists', error);
  }
});
