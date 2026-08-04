/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

export async function updateIcalChannel(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sql = getSql();
    const body = await request.json();

    const existing = await sql.row<any>('SELECT * FROM ical_channels WHERE id = ?', [id]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    const { ical_url, source_code, sync_interval_minutes, is_active } = body;

    await sql.run(`
      UPDATE ical_channels SET
        ical_url = ?,
        source_code = ?,
        sync_interval_minutes = ?,
        is_active = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [ical_url ?? existing.ical_url,
      source_code ?? existing.source_code,
      sync_interval_minutes ?? existing.sync_interval_minutes,
      is_active ?? existing.is_active,
      id]);

    const updated = await sql.row<any>('SELECT * FROM ical_channels WHERE id = ?', [id]);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function deleteIcalChannel(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sql = getSql();

    const existing = await sql.row<any>('SELECT id FROM ical_channels WHERE id = ?', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    await sql.run('DELETE FROM ical_sync_log WHERE channel_id = ?', [id]);
    await sql.run('DELETE FROM ical_channels WHERE id = ?', [id]);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
