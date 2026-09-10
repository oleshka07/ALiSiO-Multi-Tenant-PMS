/**
 * Картка застосунку «Кіоск» — власник.
 *
 * `POST …/admin/pairings` — новий код парування (показується раз);
 * `GET  …/admin/devices` — термінали з останнім звʼязком;
 * `POST …/admin/devices/<id>/revoke` — відкликати.
 *
 * ── Де це лежить ────────────────────────────────────────────────────────
 *
 * Під `/api/settings/apps/kiosk/` — там, де ВСІ картки застосунків
 * (`winhotel-import/token`, `fiskaly/connect`). Тобто у звичайному
 * охоронюваному контурі: `proxy.ts` вимагає сесію, `check-route-guards`
 * вимагає варту.
 *
 * Перша редакція клала картку під публічний префікс кіоска, у сегмент
 * `admin/`, і мусила захищати його заперечним поглядом уперед у гейті. Це
 * працювало, але означало другу домівку для однієї картки і виняток, який
 * треба памʼятати. Частина В прибрала і те, і те.
 *
 * Окремим файлом від публічного парування — див. шапку `pairing.handlers.ts`.
 */
import { NextResponse } from 'next/server';
import { withOwner, type Actor } from '@core/auth/session';
import { hasFeature } from '@core/features';
import { handleError, refuse } from '@core/http/errors';
import { ownsProperty } from '@properties/kernel';
import { ALL_PROPERTIES, oneProperty, requirePropertyScope, requestedPropertyParam } from '@core/property-scope';
import { getSql } from '@core/db/async';
import { createPairing, listDevices, revokeDevice } from '../data/devices.repo';
import { kioskDay } from '../data/today.repo';
import {
  KIOSK_SIGNATURE_MODES, readAutoAssign, readSignatureMode, readTime,
} from '../domain/search';
import { DEFAULT_TOUCH_BAND } from './session.handlers';

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


/**
 * Політики обʼєкта для картки застосунку.
 *
 * `GET` віддає ЧИТАНІ значення (через ті самі функції домену, що їх читає
 * термінал), а не сирі колонки: інакше картка показувала б одне, а екран у
 * холі поводився б за іншим — рівно та розбіжність, від якої існує домен.
 */
export const getKioskPolicies = withOwner(async (
  request: Request,
  _ctx: unknown,
  actor: Actor,
) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const url = new URL(request.url);
    const propertyId = (url.searchParams.get('property_id') ?? '').trim();
    if (!propertyId || !(await ownsProperty(actor.organizationId, propertyId))) refuse('Не знайдено', 404);

    const row = await getSql().row<{
      checkin_payment_policy: string | null; system_of_record: string | null;
      kiosk_walkin_url: string | null; kiosk_auto_assign: unknown;
      kiosk_signature: string | null; kiosk_earliest_checkin: string | null;
      kiosk_latest_checkout: string | null;
    }>(`SELECT checkin_payment_policy, system_of_record, kiosk_walkin_url,
               kiosk_auto_assign, kiosk_signature, kiosk_earliest_checkin, kiosk_latest_checkout
          FROM properties WHERE id = ? AND organization_id = ?`,
      [propertyId, actor.organizationId]);
    if (!row) refuse('Не знайдено', 404);

    return NextResponse.json({
      checkinPaymentPolicy: row.checkin_payment_policy === 'allow_pay_later' ? 'allow_pay_later' : 'prepaid',
      systemOfRecord: row.system_of_record === 'external' ? 'external' : 'alisio',
      walkinUrl: row.kiosk_walkin_url ?? '',
      autoAssign: readAutoAssign(row.kiosk_auto_assign),
      signature: readSignatureMode(row.kiosk_signature),
      earliestCheckIn: readTime(row.kiosk_earliest_checkin),
      latestCheckOut: readTime(row.kiosk_latest_checkout),
    });
  } catch (error) {
    return handleError('apps/kiosk getKioskPolicies', error, 'Не вдалося прочитати політики');
  }
});

/**
 * Записати політики. Кожне значення приводиться до відомого ТУТ, а не
 * покладається на CHECK: відмова обмеження прилітає 500-кою і стек-трейсом,
 * а неправильне слово з форми — це звичайна помилка, і відповідь на неї
 * названа (інваріант 6).
 */
export const saveKioskPolicies = withOwner(async (
  request: Request,
  _ctx: unknown,
  actor: Actor,
) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const propertyId = String(body.propertyId ?? '').trim();
    if (!propertyId || !(await ownsProperty(actor.organizationId, propertyId))) refuse('Не знайдено', 404);

    const payment = body.checkinPaymentPolicy === 'allow_pay_later' ? 'allow_pay_later' : 'prepaid';
    const signature = String(body.signature ?? '');
    if (!KIOSK_SIGNATURE_MODES.includes(signature as never)) refuse('bad_signature_mode', 400);
    const walkin = String(body.walkinUrl ?? '').trim();
    // Адреса walk-in — або порожньо, або справжня http(s)-адреса: рядок
    // «schlossberghotel» у цьому полі дав би терміналу кнопку в нікуди.
    if (walkin && !/^https?:\/\//i.test(walkin)) refuse('bad_walkin_url', 400);

    const earliest = body.earliestCheckIn == null || body.earliestCheckIn === ''
      ? null : readTime(body.earliestCheckIn);
    const latest = body.latestCheckOut == null || body.latestCheckOut === ''
      ? null : readTime(body.latestCheckOut);
    // Названа, але незрозуміла година — відмова, а не тихий NULL: «зберегли»
    // із порожнім полем означало б, що готель думає, ніби обмеження стоїть.
    if (body.earliestCheckIn && !earliest) refuse('bad_time', 400);
    if (body.latestCheckOut && !latest) refuse('bad_time', 400);

    await getSql().run(`
      UPDATE properties
         SET checkin_payment_policy = ?, kiosk_walkin_url = ?, kiosk_auto_assign = ?,
             kiosk_signature = ?, kiosk_earliest_checkin = ?, kiosk_latest_checkout = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ?
    `, [payment, walkin || null, body.autoAssign === false ? 0 : 1,
      signature, earliest, latest, propertyId, actor.organizationId]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError('apps/kiosk saveKioskPolicies', error, 'Не вдалося зберегти політики');
  }
});

/**
 * Вигляд одного термінала: робоча смуга, лого, фон, мови.
 *
 * Лежить у `config_json` ПРИСТРОЮ, а не обʼєкта: у холі корпусу може стояти
 * інший дисплей, і смуга 35–85 % на ньому означає іншу висоту в сантиметрах.
 *
 * Смуга перевіряється ТУТ тим самим правилом, що читає сесія
 * (`touchBand()`): два числа, у межах 0–100, верх вище низу. Смуга, яка не
 * смуга, не записується — інакше кнопки лягли б на весь екран, і це помітили б
 * у холі, а не на картці.
 */
export const saveDeviceConfig = withOwner(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const band = body.touchBand as { top?: unknown; bottom?: unknown } | undefined;
    const top = Number(band?.top ?? DEFAULT_TOUCH_BAND.top);
    const bottom = Number(band?.bottom ?? DEFAULT_TOUCH_BAND.bottom);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)
        || top < 0 || bottom > 100 || top >= bottom) {
      refuse('bad_touch_band', 400);
    }

    const config = JSON.stringify({
      touch_band: { top, bottom },
      logo_url: String(body.logoUrl ?? '').trim() || null,
      background_url: String(body.backgroundUrl ?? '').trim() || null,
    });

    const done = await getSql().run(
      'UPDATE kiosk_devices SET config_json = ? WHERE id = ? AND organization_id = ?',
      [config, id, actor.organizationId]);
    // Чужий термінал — «немає» (інваріант 5), а не мовчазний нуль рядків.
    if (done.changes === 0) refuse('Не знайдено', 404);

    return NextResponse.json({ ok: true, touchBand: { top, bottom } });
  } catch (error) {
    return handleError('apps/kiosk saveDeviceConfig', error, 'Не вдалося зберегти вигляд');
  }
});

/** Сторінка «Kiosk heute»: події доби ГОТЕЛЮ (не UTC) і підсумок. */
export const getKioskToday = withOwner(async (
  request: Request,
  _ctx: unknown,
  actor: Actor,
) => {
  try {
    if (!(await hasFeature(actor.organizationId, APP))) refuse('Не знайдено', 404);
    const url = new URL(request.url);
    const propertyId = (url.searchParams.get('property_id') ?? '').trim();
    if (propertyId && !(await ownsProperty(actor.organizationId, propertyId))) refuse('Не знайдено', 404);
    const day = (url.searchParams.get('day') ?? '').trim() || null;

    const data = await kioskDay({
      organizationId: actor.organizationId,
      // «Усі будинки» пишеться словом, а не відсутністю параметра.
      scope: propertyId ? oneProperty(propertyId) : ALL_PROPERTIES,
      day,
    });
    return NextResponse.json(data);
  } catch (error) {
    return handleError('apps/kiosk getKioskToday', error, 'Не вдалося прочитати добу');
  }
});
