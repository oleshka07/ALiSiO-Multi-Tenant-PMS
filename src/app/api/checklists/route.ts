import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { withActor, type Actor } from '@core/auth/session';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Shift checklists for the mobile app.
 *
 * What was here answered 500 on every call: it read a `bookings` table that
 * does not exist in this schema — the table is `reservations` — so
 * MobileShiftChecklists has shown nothing since the code arrived.
 *
 * The checklists themselves were not a bug to patch. All of them were written
 * out in full for one hotel: a sauna inspection triggered by units or notes
 * containing "сауна", and a daily round of "Будинок F / Будинок D". Neither
 * means anything to a second customer, and shipping them would put another
 * hotel's building names on every screen. So this returns the part that is
 * genuinely general — which rooms need cleaning — and no checklists until they
 * are something an organization defines. A `checklists` table with per-item
 * rules is the actual feature, and it is not this change.
 */
export const GET = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    const db = getDb();

    // Scoped: unqualified this listed every hotel's dirty rooms.
    const dirtyUnits = db.prepare(`
      SELECT u.id, u.code, u.name, u.cleaning_status, u.building_id
      FROM units u
      JOIN properties p ON p.id = u.property_id
      WHERE p.organization_id = ?
        AND u.cleaning_status IN ('dirty', 'in_progress')
      ORDER BY u.code ASC
    `).all(actor.organizationId) as any[];

    return NextResponse.json({
      success: true,
      dirtyUnitsCount: dirtyUnits.length,
      dirtyUnits,
      checklists: [],
    });
  } catch (error: any) {
    console.error('GET /api/checklists error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to load checklists' }, { status: 500 });
  }
});
