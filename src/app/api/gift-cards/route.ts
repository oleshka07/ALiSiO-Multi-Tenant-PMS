import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { getSql } from '@core/db/async';
import { withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';
import { buildGiftCode, getGiftCardTemplate, calcExpiresAt, GIFT_CARD_TEMPLATES } from '@/modules/widget/domain/gift-card-builder';

/**
 * Gift cards / vouchers.
 *
 * These routes never established who was calling: any logged-in user of any
 * hotel could list every hotel's vouchers with their buyer names and emails,
 * and mint new ones against any property_id they cared to send. The list
 * started from `WHERE 1=1`, and the auto-expire sweep updated every hotel's
 * rows at once.
 */

// GET /api/gift-cards — список ваучерів
export const GET = await withPermission('manage_bookings', async (req: Request, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const url = new URL(req.url);
    const propertyId = url.searchParams.get('propertyId') || url.searchParams.get('property_id');
    const siteId = url.searchParams.get('site_id');
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search') || '';

    let statement = `
      SELECT v.*,
             r.check_in, r.check_out, r.unit_id
      FROM gift_cards v
      LEFT JOIN reservations r ON v.reservation_id = r.id
      WHERE v.organization_id = ?
    `;
    const params: (string | number)[] = [actor.organizationId];

    if (propertyId) {
      statement += ' AND v.property_id = ?';
      params.push(propertyId);
    } else if (siteId) {
      statement += ' AND v.property_id = (SELECT property_id FROM booking_sites WHERE id = ?)';
      params.push(siteId);
    }
    if (status && status !== 'all') {
      statement += ' AND v.status = ?';
      params.push(status);
    }
    if (search) {
      statement += ' AND (v.code LIKE ? OR v.name LIKE ? OR v.recipient_name LIKE ? OR v.buyer_name LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    statement += ' ORDER BY v.created_at DESC';

    const giftCards = await sql.rows(statement, params);

    // Auto-expire: оновити статус прострочених ваучерів
    // UTC, because that is what SQLite's date('now') returned here.
    const today = new Date().toISOString().slice(0, 10);
    await sql.run(`
      UPDATE gift_cards SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ?
        AND status IN ('active', 'paid')
        AND expires_at IS NOT NULL
        AND expires_at < ?
    `, [actor.organizationId, today]);

    return NextResponse.json({ gift_cards: giftCards, templates: GIFT_CARD_TEMPLATES });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GET /api/gift-cards error:', message);
    return NextResponse.json({ error: 'Failed to fetch gift cards' }, { status: 500 });
  }
});

// POST /api/gift-cards — створити ваучер
export const POST = await withPermission('manage_bookings', async (req: Request, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const body = await req.json();
    let { property_id } = body;
    const {
      site_id,
      template_id,
      name,
      type,
      value_type,
      face_value,
      currency,
      recipient_name,
      recipient_email,
      buyer_name,
      buyer_email,
      buyer_phone,
      message,
      expires_at,
      config_json,
      notes,
      status = 'active',
    } = body;

    // Resolve site_id to property_id if property_id is not directly provided
    if (!property_id && site_id) {
      const site = await sql.row<{ property_id: string }>(`
        SELECT s.property_id FROM booking_sites s
        JOIN properties p ON p.id = s.property_id
        WHERE s.id = ? AND p.organization_id = ?
      `, [site_id, actor.organizationId]);
      if (site) property_id = site.property_id;
    }

    // The property_id arrives in the request body, so it is verified against
    // the session's organization rather than trusted.
    try {
      property_id = await requirePropertyId(property_id);
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'property_id or valid site_id is required' },
        { status: 400 },
      );
    }

    // Визначаємо параметри з шаблону або з тіла запиту
    const tpl = template_id ? getGiftCardTemplate(template_id) : null;
    const resolvedName = name || tpl?.name || 'Ваучер';
    const resolvedType = type || tpl?.type || 'open_date';
    const resolvedValueType = value_type || tpl?.value_type || 'fixed_czk';
    const resolvedFaceValue = face_value ?? tpl?.face_value ?? 0;
    const resolvedCurrency = currency || tpl?.currency || 'CZK';
    const resolvedConfig = config_json ?? tpl?.config_json ?? {};
    const resolvedExpires = expires_at
      || (tpl ? calcExpiresAt(tpl.validityMonths) : calcExpiresAt(12));

    // Генерація коду. It only has to be unique inside this organization —
    // a code is redeemed on one hotel's site, and two hotels may both issue
    // the same string.
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = buildGiftCode();
      const existing = await sql.row(
        'SELECT id FROM gift_cards WHERE code = ? AND organization_id = ?',
        [candidate, actor.organizationId],
      );
      if (!existing) { code = candidate; break; }
    }
    if (!code) {
      return NextResponse.json({ error: 'Failed to generate unique giftCard code' }, { status: 500 });
    }

    // RETURNING * rather than RETURNING id plus a SELECT: the row it hands back
    // is the row that was just written, defaults and all.
    const gift_card = await sql.row(`
      INSERT INTO gift_cards (
        organization_id, property_id, code, template_id, name, type, value_type,
        face_value, currency, status,
        recipient_name, recipient_email,
        buyer_name, buyer_email, buyer_phone,
        message, expires_at, config_json, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [
      actor.organizationId, property_id, code, template_id || 'custom', resolvedName,
      resolvedType, resolvedValueType, resolvedFaceValue, resolvedCurrency,
      status, recipient_name || null, recipient_email || null,
      buyer_name || null, buyer_email || null, buyer_phone || null,
      message || null, resolvedExpires, JSON.stringify(resolvedConfig), notes || null,
    ]);
    return NextResponse.json({ giftCard: gift_card }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/gift-cards error:', message);
    return NextResponse.json({ error: 'Failed to create gift card' }, { status: 500 });
  }
});
