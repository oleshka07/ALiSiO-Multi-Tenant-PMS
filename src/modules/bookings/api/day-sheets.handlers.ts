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
import { withActor } from '@core/auth/session';
import { houseList, breakfastList, keyList, dayClose } from '../data/day-sheets.repo';

/** A calendar day, defaulting to today. */
function dateFrom(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('date');
  if (!raw) return new Date().toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export const getDaySheet = withActor(async (
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) => {
  const { kind } = await params;
  const date = dateFrom(request);
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
