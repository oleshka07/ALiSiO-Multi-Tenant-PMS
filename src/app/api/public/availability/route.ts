/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

/**
 * GET /api/public/availability
 * Public endpoint — no auth required.
 * Query params:
 *   unit_id       – specific unit ID
 *   unit_type_id  – unit type ID (returns all units of this type)
 *   site_id       – booking site ID (optional, for future scoping)
 *   from          – YYYY-MM-DD (default: today)
 *   to            – YYYY-MM-DD (default: +180 days)
 *
 * Returns:
 *   { bookedRanges: [{check_in, check_out}[],  bookedDates: string[] }
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const unit_id      = url.searchParams.get('unit_id');
    const unit_type_id = url.searchParams.get('unit_type_id');

    if (!unit_id && !unit_type_id) {
      return NextResponse.json({ error: 'unit_id or unit_type_id required' }, { status: 400 });
    }

    const today = new Date();
    const fromStr = url.searchParams.get('from') || today.toISOString().split('T')[0];
    const toDate  = new Date(today); toDate.setDate(toDate.getDate() + 365);
    const toStr   = url.searchParams.get('to') || toDate.toISOString().split('T')[0];

    const sql = getSql();

    let rows: any[];

    if (unit_id) {
      rows = await sql.rows<any>(`
        SELECT check_in, check_out FROM reservations
        WHERE unit_id = ?
          AND status NOT IN ('cancelled','no_show')
          AND check_out > ? AND check_in < ?
        ORDER BY check_in
      `, [unit_id, fromStr, toStr]);
    } else {
      // All units of this unit_type
      const units = await sql.rows<any>(`SELECT id FROM units WHERE unit_type_id = ?`, [unit_type_id!]);
      if (units.length === 0) return NextResponse.json({ bookedRanges: [], bookedDates: [] });
      const placeholders = units.map(() => '?').join(',');
      const ids = units.map((u: any) => u.id);
      rows = await sql.rows<any>(`
        SELECT check_in, check_out FROM reservations
        WHERE unit_id IN (${placeholders})
          AND status NOT IN ('cancelled','no_show')
          AND check_out > ? AND check_in < ?
        ORDER BY check_in
      `, [...ids, fromStr, toStr]);
    }

    // Expand ranges to individual booked dates
    const bookedSet = new Set<string>();
    for (const r of rows) {
      let d = new Date(r.check_in + 'T00:00:00');
      const end = new Date(r.check_out + 'T00:00:00');
      while (d < end) {
        bookedSet.add(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
      }
    }

    const res = NextResponse.json({
      bookedRanges: rows.map((r: any) => ({ check_in: r.check_in, check_out: r.check_out })),
      bookedDates: Array.from(bookedSet).sort(),
    });

    // Allow cross-origin (embed widget on external sites)
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Cache-Control', 'public, max-age=300'); // 5 min cache
    return res;
  } catch (e: any) {
    console.error('[public/availability]', e?.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    },
  });
}
