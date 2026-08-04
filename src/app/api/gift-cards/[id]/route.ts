import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { withPermission, notFound, type Actor } from '@core/auth/session';

/** Every lookup is constrained by the organization; a stranger's id is a 404. */
type IdParams = { params: Promise<{ id: string }> };

// GET /api/gift-cards/[id]
export const GET = await withPermission('manage_bookings', async (_req, { params }: IdParams, actor: Actor) => {
  try {
    const db = getDb();
    const { id } = await params;
    const gift_card = db.prepare(`
      SELECT v.*,
             r.check_in, r.check_out, r.unit_id,
             u.name as unit_name
      FROM gift_cards v
      LEFT JOIN reservations r ON v.reservation_id = r.id
      LEFT JOIN units u ON r.unit_id = u.id
      WHERE v.id = ? AND v.organization_id = ?
    `).get(id, actor.organizationId);
    if (!gift_card) return notFound();
    return NextResponse.json({ giftCard: gift_card });
  } catch (err: unknown) {
    console.error('GET /api/gift-cards/[id] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to fetch gift card' }, { status: 500 });
  }
});

// PATCH /api/gift-cards/[id] — оновити поля ваучера
export const PATCH = await withPermission('manage_bookings', async (req, { params }: IdParams, actor: Actor) => {
  try {
    const db = getDb();
    const { id } = await params;
    const body = await req.json();

    const existing = db.prepare('SELECT id, status FROM gift_cards WHERE id = ? AND organization_id = ?')
      .get(id, actor.organizationId) as { id: string; status: string } | undefined;
    if (!existing) return notFound();

    // Дозволені поля для оновлення
    const allowed = [
      'status', 'recipient_name', 'recipient_email',
      'buyer_name', 'buyer_email', 'buyer_phone',
      'message', 'expires_at', 'notes', 'paid_at', 'config_json',
    ];

    const sets: string[] = [];
    const vals: (string | number | null)[] = [];

    for (const key of allowed) {
      if (key in body) {
        sets.push(`${key} = ?`);
        vals.push(key === 'config_json' ? JSON.stringify(body[key]) : (body[key] ?? null));
      }
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    sets.push("updated_at = datetime('now')");
    vals.push(id, actor.organizationId);

    db.prepare(`UPDATE gift_cards SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`).run(...vals);

    const updated = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
    return NextResponse.json({ giftCard: updated });
  } catch (err: unknown) {
    console.error('PATCH /api/gift-cards/[id] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to update gift card' }, { status: 500 });
  }
});

// DELETE /api/gift-cards/[id] — м'яке видалення (→ cancelled)
export const DELETE = await withPermission('manage_bookings', async (_req, { params }: IdParams, actor: Actor) => {
  try {
    const db = getDb();
    const { id } = await params;
    const existing = db.prepare('SELECT id, status FROM gift_cards WHERE id = ? AND organization_id = ?')
      .get(id, actor.organizationId) as { id: string; status: string } | undefined;
    if (!existing) return notFound();

    if (existing.status === 'activated') {
      return NextResponse.json({ error: 'Cannot cancel a activated giftCard' }, { status: 409 });
    }

    db.prepare(`
      UPDATE gift_cards SET status = 'cancelled', updated_at = datetime('now')
      WHERE id = ? AND organization_id = ?
    `).run(id, actor.organizationId);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('DELETE /api/gift-cards/[id] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to cancel gift card' }, { status: 500 });
  }
});
