/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import * as guestsRepo from '../data/guests.repo';
import { exportGuestsCsv } from '../data/guests-export.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { todayFor } from '@core/hotel-day';

/**
 * The organization comes from the session. Guest records hold names, emails,
 * phone numbers and document numbers, so an unscoped list here is a personal
 * data leak rather than a display bug.
 */

/** Фільтри з адреси — однакові для списку і для експорту (Блок 4 §2.5). */
function guestFilters(request: NextRequest): guestsRepo.GuestFilters {
  const q = new URL(request.url).searchParams;
  const flag = (k: string) => q.get(k) === '1' || q.get(k) === 'true';
  return {
    search: q.get('search') || undefined,
    country: q.get('country') || undefined,
    hasContacts: flag('has_contacts'),
    hasUpcoming: flag('has_upcoming'),
    hasCompany: flag('has_company'),
  };
}

export const listGuests = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const result = await guestsRepo.listGuests(actor.organizationId, guestFilters(request), page, limit);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GET /api/guests error:', error);
    return NextResponse.json({ error: 'Failed to fetch guests' }, { status: 500 });
  }
});

/**
 * GET /api/guests/export-csv?format=simple|extended — той самий список, що
 * на екрані, тими самими фільтрами.
 *
 * Право `manage_guests`, а не перегляд: розширений набір несе номер
 * документа, дату народження й адресу — це вивантаження персональних даних
 * файлом, який далі живе поза системою.
 */
export const exportGuests = withPermission('manage_guests', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const format = new URL(request.url).searchParams.get('format') === 'extended' ? 'extended' : 'simple';
    const csv = await exportGuestsCsv(actor.organizationId, guestFilters(request), format);
    // Дата у назві файла — день ГОТЕЛЮ: о 23:30 у Празі файл, названий
    // завтрашнім числом, лягає в теку не тим днем, а звіряють його з
    // денним списком.
    const day = await todayFor(actor.organizationId);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="guests-${format}-${day}.csv"`,
      },
    });
  } catch (error: any) {
    return serverError('modules/guests/api/guests exportGuests', error, 'Failed to export guests');
  }
});

export const createGuest = withPermission('manage_guests', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { firstName, lastName } = body;

    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const guestId = await guestsRepo.createGuest(actor.organizationId, body);
    return NextResponse.json({ id: guestId }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/guests error:', error);
    return NextResponse.json({ error: 'Failed to create guest' }, { status: 500 });
  }
});
