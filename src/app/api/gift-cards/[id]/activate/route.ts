import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { withPermission, notFound, type Actor } from '@core/auth/session';

// POST /api/gift-cards/[id]/activate — погасити ваучер (прив'язати до бронювання)
// Both the voucher and the reservation come from the request, so both are
// checked against the caller's organization: unqualified, one hotel's voucher
// could be redeemed against another hotel's booking.
export const POST = await withPermission('manage_bookings', async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const db = getDb();
    const { id } = await params;
    const body = await req.json();
    const { reservation_id } = body;

    if (!reservation_id) {
      return NextResponse.json({ error: 'reservation_id is required' }, { status: 400 });
    }

    const gift_card = db.prepare('SELECT * FROM gift_cards WHERE id = ? AND organization_id = ?')
      .get(id, actor.organizationId) as Record<string, unknown> | undefined;
    if (!gift_card) return notFound();

    // Перевірки
    if (gift_card.status === 'activated') {
      return NextResponse.json({ error: 'GiftCard already activated' }, { status: 409 });
    }
    if (gift_card.status === 'cancelled') {
      return NextResponse.json({ error: 'GiftCard is cancelled' }, { status: 409 });
    }
    if (gift_card.status === 'expired') {
      return NextResponse.json({ error: 'GiftCard has expired' }, { status: 409 });
    }
    if (gift_card.status === 'draft') {
      return NextResponse.json({ error: 'GiftCard is not yet active' }, { status: 409 });
    }

    // Перевірка що бронювання існує
    const reservation = db.prepare(`
      SELECT r.id, r.unit_id, r.check_in
      FROM reservations r JOIN properties p ON p.id = r.property_id
      WHERE r.id = ? AND p.organization_id = ?
    `).get(reservation_id, actor.organizationId);
    if (!reservation) return notFound();

    db.prepare(`
      UPDATE gift_cards
      SET status = 'activated',
          reservation_id = ?,
          activated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reservation_id, id);

    const updated = db.prepare(`
      SELECT v.*, r.check_in, r.check_out, u.name as unit_name
      FROM gift_cards v
      LEFT JOIN reservations r ON v.reservation_id = r.id
      LEFT JOIN units u ON r.unit_id = u.id
      WHERE v.id = ?
    `).get(id);

    return NextResponse.json({ giftCard: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/gift-cards/[id]/activate error:', message);
    return NextResponse.json({ error: 'Failed to activate gift card' }, { status: 500 });
  }
})
