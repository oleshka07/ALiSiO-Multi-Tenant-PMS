/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requirePropertyId } from '@core/auth/tenant-context';
import { withActor, type Actor } from '@core/auth/session';
import { serverError, handleError } from '@core/http/errors';
import { requestPropertyScope } from '@core/auth/property-scope';
import { listSourcesOf } from '../data/lists.repo';

export const listBookingSources = withActor(async (request: Request, _ctx, actor: Actor) => {
  try {
    // booking_sources reaches an organization through its property; unscoped
    // this listed every hotel's channels and their commission percentages.
    //
    // Який ОБʼЄКТ, а не лише який орендар (INC-029): канал продажу і його
    // комісія належать будинку — у двох готелів однієї компанії різні
    // договори з тим самим Booking. Сам запит — у `data/lists.repo.ts`: у
    // маршруті його не засвідчити, бо `withActor` кличе `cookies()`.
    const scope = await requestPropertyScope(request, actor.organizationId);
    return NextResponse.json(await listSourcesOf(actor.organizationId, scope));
  } catch (e: any) {
    // Названа відмова їде своїм статусом (інваріант 6, Ц43). Тут це не
    // дрібниця: чужий `property_id` кидає `PropertyNotFound` — 404, — і
    // глухий 500 перетворював «не той будинок» на «сервер зламався».
    return handleError('modules/bookings/api/booking-sources listBookingSources', e);
  }
});

export const createBookingSource = withActor(async (request: Request) => {
  try {
    const sql = getSql();
    const body = await request.json();
    const { name, code, icon_letter, color, sort_order, commission_percent } = body;

    if (!name || !code) {
      return NextResponse.json({ error: 'name and code are required' }, { status: 400 });
    }

    let propertyId: string;
    try {
      propertyId = await requirePropertyId(body.property_id);
    } catch (e: any) {
      return handleError('booking-sources POST', e);
    }

    // A source code only has to be unique inside the property that owns it.
    const existing = await sql.row<any>('SELECT id FROM booking_sources WHERE code = ? AND property_id = ?', [code, propertyId]);
    if (existing) {
      return NextResponse.json({ error: 'Source code already exists' }, { status: 400 });
    }

    const id = `bs_${Date.now()}`;
    await sql.run('INSERT INTO booking_sources (id, property_id, name, code, icon_letter, color, sort_order, commission_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, propertyId, name, code, icon_letter || '?', color || '#6c7086', sort_order || 0, commission_percent || 0]);

    const created = await sql.row<any>('SELECT * FROM booking_sources WHERE id = ?', [id]);
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return serverError('modules/bookings/api/booking-sources createBookingSource', e);
  }
});
