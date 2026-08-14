/**
 * The Meldeschein over HTTP.
 *
 * `manage_guests`, the same permission as the guest registry: this answer
 * carries a date of birth, an address and a passport number for every person
 * on the booking, which is the most sensitive set of fields the system holds.
 *
 * There is nothing to POST. The form is derived from the booking and the
 * guests already registered; a second copy of those fields, stored so a sheet
 * could be "saved", would be personal data kept twice and deleted once.
 *
 * A stay where nobody has to register is a 200 with an empty `people` and the
 * reasons filled in — not a 404. Reception asked a real question ("does this
 * guest need a form?") and "no, because they are a German national" is the
 * answer; "not found" would look like a bug and send them back to paper.
 */
import { NextResponse } from 'next/server';
import { withPermission } from '@core/auth/session';
import { meldescheinFor } from '../data/meldeschein.repo';

export const getMeldeschein = withPermission('manage_guests', async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    const form = await meldescheinFor(id);
    // The reservation itself is either this organization's or it does not
    // exist as far as this caller is concerned — the repo makes no distinction
    // and neither does the answer.
    if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(form);
  } catch (e) {
    console.error('[meldeschein]', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
});
