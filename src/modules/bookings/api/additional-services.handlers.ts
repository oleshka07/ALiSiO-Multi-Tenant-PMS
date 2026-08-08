/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

export async function listAdditionalServices() {
  try {
    const sql = getSql();
    const services = await sql.rows<any>('SELECT * FROM additional_services ORDER BY sort_order, name');
    return NextResponse.json(services);
  } catch (error: any) {
    console.error('GET /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function createAdditionalService(request: NextRequest) {
  try {
    const sql = getSql();
    const body = await request.json();
    const id = 'svc_' + Date.now().toString(36);
    await sql.run(`
      INSERT INTO additional_services (id, property_id, name, name_en, description, price, currency, unit_label, icon, category, available_for, is_active, sort_order, service_type, duration_minutes, name_cs, name_de)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?)
    `, [id,
      body.property_id || 'prop_main_001',
      body.name || '', body.name_en || '', body.description || '',
      body.price || 0, body.currency || 'CZK', body.unit_label || '',
      body.icon || '✨', body.category || 'other', body.available_for || 'all',
      body.sort_order || 99, body.service_type || 'simple',
      body.duration_minutes || null, body.name_cs || null, body.name_de || null]);
    const created = await sql.row<any>('SELECT * FROM additional_services WHERE id = ?', [id]);
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/additional-services error:', error?.message);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}

export async function updateAdditionalService(request: NextRequest) {
  try {
    const sql = getSql();
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const fields = [
      'name', 'name_en', 'description', 'price', 'currency', 'unit_label',
      'icon', 'category', 'available_for', 'is_active', 'sort_order',
      'service_type', 'duration_minutes', 'name_cs', 'name_de',
    ];
    const sets: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(body[f]);
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
}

export async function deleteAdditionalService(request: NextRequest) {
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
}
