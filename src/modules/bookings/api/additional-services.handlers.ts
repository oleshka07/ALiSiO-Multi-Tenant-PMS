/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, withPermission } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';

export const listAdditionalServices = withActor(async () => {
  try {
    const sql = getSql();
    const services = await sql.rows<any>('SELECT * FROM additional_services ORDER BY sort_order, name');
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
    await sql.run(`
      INSERT INTO additional_services (id, property_id, name, name_en, description, price, currency, unit_label, icon, category, available_for, is_active, sort_order, service_type, duration_minutes, name_cs, name_de, vat_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?, ?)
    `, [id,
      await requirePropertyId(body.property_id),
      body.name || '', body.name_en || '', body.description || '',
      body.price || 0, body.currency || 'CZK', body.unit_label || '',
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

export const updateAdditionalService = withPermission('manage_properties', async (request: NextRequest) => {
  try {
    const sql = getSql();
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

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
      values.push(body.id);
      await sql.run(`UPDATE additional_services SET ${sets.join(', ')} WHERE id = ?`, [...values]);
    }
    const updated = await sql.row<any>('SELECT * FROM additional_services WHERE id = ?', [body.id]);
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PUT /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
});

export const deleteAdditionalService = withPermission('manage_properties', async (request: NextRequest) => {
  try {
    const sql = getSql();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await sql.run('DELETE FROM additional_services WHERE id = ?', [id]);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('DELETE /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
});
