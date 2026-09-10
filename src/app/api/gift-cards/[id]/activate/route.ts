import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withPermission, notFound, type Actor } from '@core/auth/session';

// POST /api/gift-cards/[id]/activate — погасити ваучер (прив'язати до бронювання)
// Both the voucher and the reservation come from the request, so both are
// checked against the caller's organization: unqualified, one hotel's voucher
// could be redeemed against another hotel's booking.
//
// ── І та сама фраза, тільки про БУДИНОК (INC-029, 09.09.2026) ────────────
//
// Коментар вище описує полагоджену половину, і слово «hotel» у ньому означає
// РАХУНОК. Але `gift_cards.property_id` — `NOT NULL`: ваучер продано будинком,
// і саме той будинок винен послугу. Бронь звірялась лише з рахунком, тож
// ваучер обʼєкта А гасився проти броні обʼєкта Б — у межах одного рахунку і
// без жодної помилки.
//
// Це не «видно зайве», це ГРОШІ: зобовʼязання одного будинку закриває виручку
// іншого, і в жодних книгах цього переказу немає. Каса стоїть у будинку (Д52),
// і ваучер — така сама каса, тільки видана наперед.
//
// Тому обʼєкт броні звіряється з обʼєктом ВАУЧЕРА, а не лише з рахунком.
// Ваучер, який має гаситись у будь-якому будинку мережі, — це інший продукт
// (`property_id` мусив би бути нульовим), і його немає: колонка `NOT NULL`.
// Тіло іменованою функцією — щоб сцена кликала МАРШРУТ, а не переписаний
// запит: `withPermission` кличе `cookies()`, і поза запитом Next це кидає.
export async function activateGiftCard(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) {
  try {
    const sql = getSql();
    const { id } = await params;
    const body = await req.json();
    const { reservation_id } = body;

    if (!reservation_id) {
      return NextResponse.json({ error: 'reservation_id is required' }, { status: 400 });
    }

    const gift_card = await sql.row<Record<string, unknown> & { property_id: string }>(
      'SELECT * FROM gift_cards WHERE id = ? AND organization_id = ?',
      [id, actor.organizationId],
    );
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

    // Перевірка що бронювання існує — і що воно ТОГО САМОГО БУДИНКУ.
    // Чужий обʼєкт тут 404, а не 403 і не тиха відмова: бронь, якої цей
    // ваучер не може закрити, для нього не існує (інваріанти 5 і 13).
    const reservation = await sql.row(`
      SELECT r.id, r.unit_id, r.check_in
      FROM reservations r JOIN properties p ON p.id = r.property_id
      WHERE r.id = ? AND p.organization_id = ? AND r.property_id = ?
    `, [reservation_id, actor.organizationId, gift_card.property_id]);
    if (!reservation) return notFound();

    await sql.run(`
      UPDATE gift_cards
      SET status = 'activated',
          reservation_id = ?,
          activated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reservation_id, id]);

    const updated = await sql.row(`
      SELECT v.*, r.check_in, r.check_out, u.name as unit_name
      FROM gift_cards v
      LEFT JOIN reservations r ON v.reservation_id = r.id
      LEFT JOIN units u ON r.unit_id = u.id
      WHERE v.id = ?
    `, [id]);

    return NextResponse.json({ giftCard: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/gift-cards/[id]/activate error:', message);
    return NextResponse.json({ error: 'Failed to activate gift card' }, { status: 500 });
  }
}

export const POST = await withPermission('manage_bookings', activateGiftCard);
