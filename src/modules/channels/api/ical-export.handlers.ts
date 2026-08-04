/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { generateICal } from '@/modules/channels/domain/ical'; // TODO: move to @core/ical

export async function exportIcal(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const sql = getSql();

    const channel = await sql.row<any>('SELECT * FROM ical_channels WHERE export_token = ?', [token]) as any;
    if (!channel) {
      return new Response(generateICal([], 'ALiSiO — Unknown'), {
        status: 200,
        headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });
    }

    let unitIds: string[] = [];
    let calName = 'ALiSiO';

    if (channel.channel_type === 'building') {
      const building = await sql.row<any>('SELECT name FROM buildings WHERE id = ?', [channel.building_id]) as any;
      calName = `ALiSiO — ${building?.name || 'Building'}`;
      const units = await sql.rows<any>('SELECT id FROM units WHERE building_id = ?', [channel.building_id]) as any[];
      unitIds = units.map((u: any) => u.id);
    } else {
      const unit = await sql.row<any>('SELECT name FROM units WHERE id = ?', [channel.unit_id]) as any;
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
    `, [...unitIds, thirtyDaysAgo]) as any[];

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
  } catch (e: any) {
    console.error('[iCal Export] Error:', e);
    const fallback = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ALiSiO PMS//Channel Manager//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n';
    return new Response(fallback, {
      status: 200,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
  }
}
