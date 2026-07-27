/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '@core/db';
import { generateICal } from '@/lib/ical'; // TODO: move to @core/ical

export async function exportIcal(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const db = getDb();

    const channel = db.prepare('SELECT * FROM ical_channels WHERE export_token = ?').get(token) as any;
    if (!channel) {
      return new Response(generateICal([], 'ALiSiO — Unknown'), {
        status: 200,
        headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });
    }

    let unitIds: string[] = [];
    let calName = 'ALiSiO';

    if (channel.channel_type === 'building') {
      const building = db.prepare('SELECT name FROM buildings WHERE id = ?').get(channel.building_id) as any;
      calName = `ALiSiO — ${building?.name || 'Building'}`;
      const units = db.prepare('SELECT id FROM units WHERE building_id = ?').all(channel.building_id) as any[];
      unitIds = units.map((u: any) => u.id);
    } else {
      const unit = db.prepare('SELECT name FROM units WHERE id = ?').get(channel.unit_id) as any;
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
    const reservations = db.prepare(`
      SELECT r.id, r.unit_id, r.check_in, r.check_out, r.status,
             COALESCE(g.first_name, 'OTA') as first_name,
             COALESCE(g.last_name, 'Blocked') as last_name
      FROM reservations r
      LEFT JOIN guests g ON r.guest_id = g.id
      WHERE r.unit_id IN (${placeholders})
        AND r.status IN ('confirmed', 'checked_in', 'tentative')
        AND r.check_out >= date('now', '-30 days')
    `).all(...unitIds) as any[];

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
