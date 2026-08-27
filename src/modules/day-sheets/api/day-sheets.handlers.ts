/**
 * The four morning sheets over HTTP.
 *
 * `withActor`, not a permission of their own: everyone who works a shift needs
 * the list of who is in the house, and a hotel where the breakfast count
 * requires the owner's login is a hotel that goes back to paper.
 *
 * Read-only, and there is nothing to write: every sheet is derived from
 * bookings that already exist.
 */
import { NextResponse } from 'next/server';
import { withModule, type Actor } from '@core/auth/session';
import { todayFor } from '@core/hotel-day';
import { houseList, breakfastList, keyList, dayClose } from '../data/day-sheets.repo';

/**
 * A calendar day, defaulting to today AT THE HOTEL.
 *
 * These are the housekeeping, breakfast and key sheets a receptionist prints
 * at the start of a shift. Defaulting to the server's UTC day meant the sheet
 * printed at 00:15 in Prague listed yesterday's rooms.
 */
async function dateFrom(request: Request, organizationId: string): Promise<string | null> {
  const raw = new URL(request.url).searchParams.get('date');
  if (!raw) return todayFor(organizationId);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export const getDaySheet = withModule('day_sheets', null, async (
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
  actor: Actor,
) => {
  const { kind } = await params;
  const date = await dateFrom(request, actor.organizationId);
  if (!date) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });

  try {
    switch (kind) {
      case 'house':      return NextResponse.json({ date, rows: await houseList(date) });
      case 'breakfast':  return NextResponse.json({ date, rows: await breakfastList(date) });
      case 'keys':       return NextResponse.json({ date, rows: await keyList(date) });
      case 'day-close':  return NextResponse.json({ date, rows: await dayClose(date) });
      default:
        return NextResponse.json({ error: 'Unknown sheet' }, { status: 404 });
    }
  } catch (e) {
    console.error('[day-sheets]', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
});
