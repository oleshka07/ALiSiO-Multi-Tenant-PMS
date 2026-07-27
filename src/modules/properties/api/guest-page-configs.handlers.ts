/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getDb } from '@core/db';

export async function listGuestPageConfigs() {
  try {
    const db = getDb();
    const configs = db.prepare(`
      SELECT gpc.*, ut.name as unit_type_name, ut.code as unit_type_code,
             c.type as category_type, c.name as category_name, c.icon as category_icon
      FROM guest_page_config gpc
      JOIN unit_types ut ON gpc.unit_type_id = ut.id
      JOIN categories c ON ut.category_id = c.id
      ORDER BY c.sort_order, ut.sort_order
    `).all();

    return NextResponse.json(configs);
  } catch (error: any) {
    console.error('GET /api/guest-page-config error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
  }
}
