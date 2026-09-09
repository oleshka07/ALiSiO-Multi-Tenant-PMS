/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { runWithPublicToken, runWithOrganization } from '@core/auth/tenant-context';
import { generateICal } from '@/modules/channels/domain/ical'; // TODO: move to @core/ical
import { ALL_PROPERTIES, oneProperty, propertyScopeFilter } from '@core/property-scope';

/** Вхід за токеном: орендаря ще немає, і будинок називає сам знайдений рядок. */
const TOKEN_IS_THE_AXIS = propertyScopeFilter(ALL_PROPERTIES, '');

/**
 * The calendar a channel manager subscribes to. The token in the URL is the
 * credential — there is no session here.
 *
 * The read used to happen on a bare connection. On Postgres that meant an
 * empty tenant context, the policy on `ical_channels` matched nothing, and the
 * handler took «no row» for «unknown token»: 200, and a calendar with no
 * events. Booking.com and Airbnb read that as «everything is free» and kept
 * selling dates the hotel had already given away. On SQLite, with no policies
 * at all, the same code worked — so nothing ever pointed here.
 *
 * Now the token opens its own row (migration 0035 lets the policy accept it),
 * and everything the calendar is made of is read as the hotel that owns it.
 */
export async function exportIcal(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Токен і Є вісь: він відкриває РІВНО ОДИН рядок, а рядок називає і
    // орендаря, і будинок. Звузити цей запит по будинку можна було б лише
    // взявши будинок із нього самого — спитати відповідь у питання. Тому
    // `ALL_PROPERTIES`, і це те саме слово й та сама причина, що в
    // `connectionByWebhookToken`: вхід за токеном, де орендаря ще немає.
    // Справжня вісь починається нижче — з `channel.property_id`.
    const channel = await runWithPublicToken(token, () =>
      getSql().row<any>(
        `SELECT * FROM ical_channels WHERE export_token = ? AND ${TOKEN_IS_THE_AXIS.sql}`,
        [token, ...TOKEN_IS_THE_AXIS.params])) as any;
    if (!channel) {
      return new Response(generateICal([], 'ALiSiO — Unknown'), {
        status: 200,
        headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });
    }

    // From here on the calendar is this hotel's data, so it is read as this
    // hotel. A channel from before the column was backfilled has no tenant to
    // act as; an empty calendar is wrong, but inventing one is worse.
    if (!channel.organization_id) {
      console.error('[iCal Export] channel without organization_id:', channel.id);
      return new Response(generateICal([], 'ALiSiO'), {
        status: 200,
        headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });
    }

    return await runWithOrganization(channel.organization_id, async () => {
    const sql = getSql();
    // Вісь ОБʼЄКТА фіда — будинок каналу, і саме тут вона важить найбільше:
    // це публічна поверхня без сесії, а віддає вона заїзди, виїзди й імена
    // гостей. `WHERE id = ?` і `WHERE unit_id IN (…)` осі не мали, тож канал,
    // заведений на номер сусіднього будинку (INC-041), публікував його
    // календар назовні під своїм токеном.
    const house = propertyScopeFilter(oneProperty(String(channel.property_id)), '');
    let unitIds: string[] = [];
    let calName = 'ALiSiO';
    {
      const unit = await sql.row<any>(
        `SELECT name FROM units WHERE id = ? AND ${house.sql}`,
        [channel.unit_id, ...house.params]) as any;
      calName = `ALiSiO — ${unit?.name || 'Unit'}`;
      unitIds = [channel.unit_id];
    }

    if (unitIds.length === 0) {
      return new Response(generateICal([], calName), {
        status: 200,
        headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });
    }

    const placeholders = unitIds.map(() => '?').join(',');
    // UTC, because that is what SQLite's date('now', '-30 days') returned here.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const reservations = await sql.rows<any>(`
      SELECT r.id, r.unit_id, r.check_in, r.check_out, r.status,
             COALESCE(g.first_name, 'OTA') as first_name,
             COALESCE(g.last_name, 'Blocked') as last_name
      FROM reservations r
      LEFT JOIN guests g ON r.guest_id = g.id
      WHERE r.unit_id IN (${placeholders})
        AND r.status IN ('confirmed', 'checked_in', 'tentative')
        AND r.check_out >= ?
        AND ${propertyScopeFilter(oneProperty(String(channel.property_id)), 'r').sql}
    `, [...unitIds, thirtyDaysAgo, ...house.params]) as any[];

    const events = reservations.map((r: any) => ({
      uid: `${r.id}@alisio-pms`,
      dtstart: r.check_in,
      dtend: r.check_out,
      summary: r.status === 'tentative' ? 'Tentative' : `Reserved - ${r.first_name} ${r.last_name}`,
    }));

    return new Response(generateICal(events, calName), {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${token}.ics"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
    });
  } catch (e: any) {
    console.error('[iCal Export] Error:', e);
    const fallback = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ALiSiO ERP//Channel Manager//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n';
    return new Response(fallback, {
      status: 200,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
  }
}
