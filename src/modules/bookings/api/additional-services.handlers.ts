/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, withPermission } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';

/**
 * `additional_services` has no organization column — it reaches the tenant
 * through `property_id → properties`, exactly like `price_calendar` does
 * through `unit_types`. Postgres has a policy that says so; SQLite has none,
 * and SQLite is where development, demos and the .check.ts files run. Named in
 * the SQL as well, so both databases give the same answer.
 */
const OWNED = 'property_id IN (SELECT id FROM properties WHERE organization_id = ?)';

export const listAdditionalServices = withActor(async (_request, _ctx, actor) => {
  try {
    const sql = getSql();
    const services = await sql.rows<any>(
      `SELECT * FROM additional_services WHERE ${OWNED} ORDER BY sort_order, name`,
      [actor.organizationId],
    );
    return NextResponse.json(services);
  } catch (error: any) {
    console.error('GET /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
});

/** The three roles fin_tax_rates knows. A service points at one, never at a number. */
const isTaxCode = (v: unknown): boolean =>
  typeof v === 'string' && ['standard', 'reduced', 'zero'].includes(v);

export const createAdditionalService = withPermission('manage_properties', async (request: NextRequest) => {
  try {
    const sql = getSql();
    const body = await request.json();
    const id = 'svc_' + Date.now().toString(36);
    const propertyId = await requirePropertyId(body.property_id);
    await sql.run(`
      INSERT INTO additional_services (id, property_id, name, name_en, description, price, currency, unit_label, icon, category, available_for, is_active, sort_order, service_type, duration_minutes, name_cs, name_de, vat_code)
      -- Валюта послуги, коли її не назвали, — валюта готелю, а не крона.
      -- (Код валюти тут без лапок навмисно: гейт check-currency-literals
      -- вирізає коментарі JS і не знає коментаря SQL усередині шаблонного
      -- рядка, тож лапки зробили б із пояснення знахідку.)
      --
      -- Тут стояв літерал, і ціна сніданку німецького готелю ставала «12 CZK»
      -- на гостьовій сторінці: саме це поле показує гість у списку послуг,
      -- у кошику і в листі про покинутий кошик.
      VALUES (?, ?, ?, ?, ?, ?,
        COALESCE(?, (SELECT o.default_currency FROM organizations o JOIN properties p ON p.organization_id = o.id WHERE p.id = ?)),
        ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?, ?)
    `, [id,
      propertyId,
      body.name || '', body.name_en || '', body.description || '',
      body.price || 0, body.currency || null, propertyId, body.unit_label || '',
      body.icon || '✨', body.category || 'other', body.available_for || 'all',
      body.sort_order || 99, body.service_type || 'simple',
      body.duration_minutes || null, body.name_cs || null, body.name_de || null,
      // The tax ROLE this service carries. Left null when nobody said, and a
      // service with null is refused when it reaches a folio rather than
      // invoiced at a rate we picked for the hotel.
      isTaxCode(body.vat_code) ? body.vat_code : null]);
    const created = await sql.row<any>('SELECT * FROM additional_services WHERE id = ?', [id]);
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
});

export const updateAdditionalService = withPermission('manage_properties', async (request: NextRequest, _ctx, actor) => {
  try {
    const sql = getSql();
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // The id comes from the request body. `manage_properties` says the caller
    // may edit services — it does not say whose. Answered 404, so a foreign id
    // and a missing one read the same from outside.
    const owned = await sql.row<any>(
      `SELECT id FROM additional_services WHERE id = ? AND ${OWNED}`,
      [body.id, actor.organizationId],
    );
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const fields = [
      'name', 'name_en', 'description', 'price', 'currency', 'unit_label',
      'icon', 'category', 'available_for', 'is_active', 'sort_order',
      'service_type', 'duration_minutes', 'name_cs', 'name_de', 'vat_code',
    ];
    const sets: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        // A tax role outside the three is refused rather than stored: it would
        // silently never match a rate, and the service would look configured.
        if (f === 'vat_code' && body[f] != null && body[f] !== '' && !isTaxCode(body[f])) continue;
        sets.push(`${f} = ?`);
        values.push(f === 'vat_code' && !body[f] ? null : body[f]);
      }
    }
    if (sets.length > 0) {
      values.push(body.id, actor.organizationId);
      await sql.run(`UPDATE additional_services SET ${sets.join(', ')} WHERE id = ? AND ${OWNED}`, [...values]);
    }
    const updated = await sql.row<any>(
      `SELECT * FROM additional_services WHERE id = ? AND ${OWNED}`,
      [body.id, actor.organizationId],
    );
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PUT /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
});

export const deleteAdditionalService = withPermission('manage_properties', async (request: NextRequest, _ctx, actor) => {
  try {
    const sql = getSql();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const info = await sql.run(
      `DELETE FROM additional_services WHERE id = ? AND ${OWNED}`,
      [id, actor.organizationId],
    );
    // Nothing deleted means the service was not this hotel's (or is already
    // gone). `{ ok: true }` for a delete that deleted nothing is how a hole
    // stays invisible.
    if (info.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('DELETE /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
});
