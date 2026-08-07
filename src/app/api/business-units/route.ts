import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, type Actor } from '@core/auth/session';

// business_units carries organization_id and the list ignored it, so every
// hotel's cost centres appeared in every other hotel's task screen.
export const GET = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const units = await sql.rows(`
      SELECT id, name, unit_type, is_active, sort_order, parent_id
      FROM business_units
      WHERE organization_id = ? AND is_active = TRUE
      ORDER BY sort_order, name
    `, [actor.organizationId]);
    return NextResponse.json(units);
  } catch (error: unknown) {
    console.error('GET /api/business-units error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
