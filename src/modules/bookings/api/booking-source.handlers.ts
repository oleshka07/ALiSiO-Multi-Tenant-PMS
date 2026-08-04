/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

export async function updateBookingSource(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const body = await request.json();
    const { name, code, icon_letter, color, sort_order, is_active, commission_percent } = body;

    const existing = await sql.row<any>('SELECT * FROM booking_sources WHERE id = ?', [id]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    if (code && code !== existing.code) {
      const dup = await sql.row<any>('SELECT id FROM booking_sources WHERE code = ? AND id != ?', [code, id]);
      if (dup) {
        return NextResponse.json({ error: 'Source code already exists' }, { status: 400 });
      }
    }

    await sql.run(`
      UPDATE booking_sources SET
        name = ?, code = ?, icon_letter = ?, color = ?, sort_order = ?, is_active = ?,
        commission_percent = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [name ?? existing.name,
      code ?? existing.code,
      icon_letter ?? existing.icon_letter,
      color ?? existing.color,
      sort_order ?? existing.sort_order,
      is_active ?? existing.is_active,
      commission_percent ?? existing.commission_percent ?? 0,
      id]);

    const updated = await sql.row<any>('SELECT * FROM booking_sources WHERE id = ?', [id]);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function deleteBookingSource(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();

    const existing = await sql.row<any>('SELECT * FROM booking_sources WHERE id = ?', [id]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    const usageCount = await sql.row<any>('SELECT COUNT(*) as cnt FROM reservations WHERE source = ?', [existing.code]) as any;

    if (usageCount?.cnt > 0) {
      return NextResponse.json(
        { error: `Неможливо видалити: ${usageCount.cnt} бронювань використовують це джерело` },
        { status: 400 }
      );
    }

    await sql.run('DELETE FROM booking_sources WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
