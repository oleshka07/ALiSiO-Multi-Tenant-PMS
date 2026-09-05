/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withModule } from '@core/auth/session';

export const listGuestPageConfigs = withModule('guest_page', null, async (_req, _ctx, actor) => {
  try {
    const sql = getSql();
    // Driven by UNIT TYPES, not by config rows. The old INNER JOIN from
    // guest_page_config showed only types that already had a row — and rows
    // were only ever created by a long-gone seed, so every hotel onboarded
    // since saw an empty list and had no way in. A type with no config is a
    // type with empty fields, not an invisible one.
    //
    // Scoped in the query, not left to RLS — these rows carry door codes,
    // and on an engine without policies the unfiltered version returned
    // every hotel's rows to any authenticated session.
    const configs = await sql.rows<any>(`
      SELECT gpc.*, ut.id as unit_type_id, ut.name as unit_type_name, ut.code as unit_type_code,
             c.type as category_type, c.name as category_name, c.icon as category_icon
      FROM unit_types ut
      JOIN categories c ON ut.category_id = c.id
      JOIN properties p ON ut.property_id = p.id
      LEFT JOIN guest_page_config gpc ON gpc.unit_type_id = ut.id
      WHERE p.organization_id = ?
      ORDER BY c.sort_order, ut.sort_order
    `, [actor.organizationId]);

    return NextResponse.json(configs);
  } catch (error: any) {
    console.error('GET /api/guest-page-config error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
  }
});
