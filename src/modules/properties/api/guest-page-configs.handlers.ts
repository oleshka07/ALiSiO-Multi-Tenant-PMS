/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor } from '@core/auth/session';

export const listGuestPageConfigs = withActor(async (_req, _ctx, actor) => {
  try {
    const sql = getSql();
    // These rows carry door codes. Scoped in the query, not left to RLS —
    // on an engine without policies the unfiltered version returned every
    // hotel's rows to any authenticated session.
    const configs = await sql.rows<any>(`
      SELECT gpc.*, ut.name as unit_type_name, ut.code as unit_type_code,
             c.type as category_type, c.name as category_name, c.icon as category_icon
      FROM guest_page_config gpc
      JOIN unit_types ut ON gpc.unit_type_id = ut.id
      JOIN categories c ON ut.category_id = c.id
      JOIN properties p ON ut.property_id = p.id
      WHERE p.organization_id = ?
      ORDER BY c.sort_order, ut.sort_order
    `, [actor.organizationId]);

    return NextResponse.json(configs);
  } catch (error: any) {
    console.error('GET /api/guest-page-config error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
  }
});
