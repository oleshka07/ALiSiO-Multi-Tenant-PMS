/**
 * «Ich habe gerade gebucht» — гість забронював сам і назвався терміналу.
 *
 * ── Що тут насправді відбувається ───────────────────────────────────────
 *
 * КІ8: walk-in іде через ВЛАСНИЙ онлайн-модуль готелю (CDSoft Onlinebuchung),
 * який пише бронь просто у Winhotel. Ми цю бронь ще не бачимо — вона прийде
 * денною дельтою за ≤ 15 хв (задача 8 сесії 5). Але гість стоїть біля екрана
 * ЗАРАЗ, і сказати йому «поверніться за чверть години» — це той самий
 * порожній хол, від якого кіоск і мав позбавити.
 *
 * Тому термінал заводить ПОПЕРЕДНЮ бронь: `tentative`, `source =
 * 'kiosk_walkin'`, `external_ref = 'winhotel-ob:<номер підтвердження>'`.
 * Дельта, прийшовши, знаходить її за цим ключем і оновлює, а не створює
 * другу — контракт для імпорту названий у задачі §3.2 крок 7.
 *
 * ── Чому «та сама пара двічі → одна бронь» тримає БАЗА ──────────────────
 *
 * На `reservations.external_ref` уже стоїть
 * `UNIQUE (organization_id, external_ref) WHERE external_ref IS NOT NULL`
 * (INC-301). Тобто друге натискання впирається в обмеження, а не в
 * старанність хендлера: гість, який тицьнув двічі, дістає ту саму бронь,
 * навіть якщо два запити пішли одночасно з двох терміналів.
 *
 * Хендлер усе одно ЧИТАЄ перед записом — але не замість обмеження, а щоб
 * відповісти по-людськи замість 500 на порушенні UNIQUE.
 *
 * ── Ціни немає, і це не забудькуватість ─────────────────────────────────
 *
 * Цю бронь рахує чужа система: гість щойно побачив у ній суму, і вигадати
 * тут друге число означало б показати йому дві різні ціни за одне
 * перебування. `total_price = 0` до приходу дельти, і екран про гроші
 * мовчить (інваріант 17: ціни, якої немає, не існує).
 */
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { runWithOrganization } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';
import { handleError, refuse } from '@core/http/errors';
import { requireDevice } from './session.handlers';
import { noteEvent } from '../data/devices.repo';
import { stayWindow } from '../domain/search';

/** Ключ походження: те, за чим дельта знайде цю бронь. */
export function walkinRef(confirmation: string): string {
  return `winhotel-ob:${confirmation.trim()}`;
}

export async function claimWalkin(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const confirmation = String(raw.confirmation ?? '').trim();
    const lastName = String(raw.lastName ?? '').trim();
    const firstName = String(raw.firstName ?? '').trim();
    const checkIn = String(raw.checkIn ?? '').trim().slice(0, 10);
    const checkOut = String(raw.checkOut ?? '').trim().slice(0, 10);
    const adults = Math.max(1, Math.min(20, Number(raw.adults) || 1));

    // Без номера підтвердження бронь не заводиться — 400 (§3.4). Це не
    // прискіпливість: без нього дельті нема за чим привʼязатись, і за
    // чверть години в базі буде ДВІ броні на одне перебування.
    if (!confirmation) refuse('need_confirmation', 400);
    if (!lastName) refuse('need_last_name', 400);
    if (!checkIn) refuse('need_check_in', 400);

    // Дати — у тому самому вікні, що й пошук: термінал заводить бронь на
    // сьогодні-завтра, а не на липень.
    const { from, to } = stayWindow(new Date().toISOString().slice(0, 10));
    if (checkIn < from || checkIn > to) refuse('check_in_out_of_window', 400);

    const outDate = checkOut && checkOut > checkIn
      ? checkOut
      : new Date(new Date(`${checkIn}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    const nights = Math.max(1, Math.round(
      (new Date(`${outDate}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86_400_000));

    const ref = walkinRef(confirmation);

    return await runWithOrganization(device.organizationId, async () => {
      const sql = getSql();

      // Уже заводили — віддаємо ту саму. Читання з віссю будинку: та сама
      // пара в сусідньому корпусі — інша бронь.
      const existing = await sql.row<{ id: string; property_id: string }>(
        'SELECT id, property_id FROM reservations WHERE organization_id = ? AND external_ref = ?',
        [device.organizationId, ref]);
      if (existing) {
        if (existing.property_id !== device.propertyId) refuse('Не знайдено', 404);
        return NextResponse.json({ ok: true, reservationId: existing.id, created: false });
      }

      const guestId = `kg_${crypto.randomBytes(8).toString('hex')}`;
      const reservationId = `kr_${crypto.randomBytes(8).toString('hex')}`;

      // `organization_id` названо ЯВНО в обох `INSERT` (інваріант 12): на
      // SQLite DEFAULT від контексту не існує, і рядок дістав би NULL-орендаря
      // беззвучно — бронь, якої не бачить жоден готель.
      await sql.run(
        'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
        [guestId, device.organizationId, firstName || '—', lastName]);
      await sql.run(`
        INSERT INTO reservations (id, organization_id, property_id, guest_id,
                                  check_in, check_out, nights, adults,
                                  status, payment_status, source, external_ref,
                                  total_price, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tentative', 'unpaid', 'kiosk_walkin', ?, 0,
                (SELECT default_currency FROM organizations WHERE id = ?))
      `, [reservationId, device.organizationId, device.propertyId, guestId,
        checkIn, outDate, nights, adults, ref, device.organizationId]);

      await noteEvent({
        organizationId: device.organizationId, deviceId: device.id,
        reservationId, kind: 'walkin_claim', result: 'ok', detail: ref,
      });
      return NextResponse.json({ ok: true, reservationId, created: true });
    });
  } catch (error) {
    return handleError('apps/kiosk claimWalkin', error, 'Не вдалося прийняти бронь');
  }
}
