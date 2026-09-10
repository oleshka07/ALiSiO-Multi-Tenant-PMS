/**
 * Картка застосунку «Кіоск» — власник.
 *
 * `POST …/admin/pairings` — новий код парування (показується раз);
 * `GET  …/admin/devices` — термінали з останнім звʼязком;
 * `POST …/admin/devices/<id>/revoke` — відкликати.
 *
 * ── Чому сегмент `admin/` ───────────────────────────────────────────────
 *
 * Увесь префікс `/api/apps/kiosk/` оголошений публічним у `proxy.ts` — у
 * кіоска десяток безсесійних маршрутів, і перелічувати їх поіменно означало б
 * забути наступний. Наслідок: маршрут картки, покладений поруч, не дістав би
 * перенаправлення на вхід. Варта в ньому є (`withOwner` встановлює і особу, і
 * орендаря), але тримає її тепер гейт, а не добра воля: перелік публічного в
 * `check-route-guards` сегмент `admin/` НЕ пропускає, тож маршрут картки без
 * варти валить збірку.
 *
 * Окремим файлом від публічного парування — див. шапку `pairing.handlers.ts`.
 */
import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { hasFeature } from '@core/features';
import { handleError, refuse } from '@core/http/errors';
import { ownsProperty } from '@properties/kernel';
import { ALL_PROPERTIES, requirePropertyScope, requestedPropertyParam } from '@core/property-scope';
import { createPairing, listDevices, revokeDevice } from '../data/devices.repo';

const APP = 'kiosk';

export const createDevicePairing = withOwner(async (request: Request, _ctx: unknown, actor: Actor) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const body = await request.json().catch(() => ({}));
    const propertyId = String((body as { propertyId?: unknown }).propertyId ?? '').trim();
    const name = String((body as { name?: unknown }).name ?? '').trim();
    if (!name) refuse('Назвіть термінал — під цим іменем він буде на картці', 400);

    // Обʼєкт — СВІЙ. Чужий id відповідає «немає» (інваріант 5): інакше код
    // парування виписався б на будинок сусіднього рахунку.
    if (!propertyId || !(await ownsProperty(actor.organizationId, propertyId))) {
      refuse('Не знайдено', 404);
    }

    const made = await createPairing({ organizationId: actor.organizationId, propertyId, name });
    // Код — у відповіді і БІЛЬШЕ ніде: у базі лежить хеш, у лозі — нічого.
    return NextResponse.json({ code: made.code, expiresAt: made.expiresAt });
  } catch (error) {
    return handleError('apps/kiosk createDevicePairing', error, 'Не вдалося створити код');
  }
});

export const listKioskDevices = withOwner(async (request: Request, _ctx: unknown, actor: Actor) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    // Область — з адреси (`?property=`), як усюди в адмінці: застосунок
    // оголошений `scope: 'property'`, тож звичайний перегляд — один будинок.
    // Параметра немає — вибір оператора ще не дійшов, і тоді картка показує
    // всі термінали рахунку СЛОВОМ (`ALL_PROPERTIES`), а не відсутністю
    // фільтра (інваріант 8).
    const raw = requestedPropertyParam(request.url);
    const scope = raw ? await requirePropertyScope(raw) : ALL_PROPERTIES;
    const rows = await listDevices(actor.organizationId, scope);
    return NextResponse.json({
      devices: rows.map((d) => ({
        id: d.id,
        name: d.name,
        propertyId: d.property_id,
        pairedAt: d.paired_at,
        lastSeenAt: d.last_seen_at,
        revokedAt: d.revoked_at,
      })),
    });
  } catch (error) {
    return handleError('apps/kiosk listKioskDevices', error, 'Не вдалося прочитати термінали');
  }
});

export const revokeKioskDevice = withOwner(async (
  _request: Request,
  context: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const { id } = await context.params;
    const done = await revokeDevice(actor.organizationId, id);
    if (!done) refuse('Не знайдено', 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError('apps/kiosk revokeKioskDevice', error, 'Не вдалося відкликати термінал');
  }
});
