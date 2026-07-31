import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { withActor, type Actor } from '@core/auth/session';

// business_units carries organization_id and the list ignored it, so every
// hotel's cost centres appeared in every other hotel's task screen.
export const GET = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    const db = getDb();
    const units = db.prepare(`
      SELECT id, name, unit_type, is_active, sort_order, parent_id
      FROM business_units
      WHERE organization_id = ? AND is_active = 1
      ORDER BY sort_order, name
    `).all(actor.organizationId);
    return NextResponse.json(units);
  } catch (error: unknown) {
    console.error('GET /api/business-units error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
