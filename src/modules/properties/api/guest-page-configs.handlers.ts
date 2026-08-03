/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

export async function listGuestPageConfigs() {
  try {
    const sql = getSql();
    const configs = await sql.rows<any>(`
      SELECT gpc.*, ut.name as unit_type_name, ut.code as unit_type_code,
             c.type as category_type, c.name as category_name, c.icon as category_icon
      FROM guest_page_config gpc
      JOIN unit_types ut ON gpc.unit_type_id = ut.id
      JOIN categories c ON ut.category_id = c.id
      ORDER BY c.sort_order, ut.sort_order
    `);

    return NextResponse.json(configs);
  } catch (error: any) {
    console.error('GET /api/guest-page-config error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
  }
}
