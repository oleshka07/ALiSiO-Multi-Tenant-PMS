/**
 * Halls over HTTP.
 *
 * Two permissions, split by what the verb touches. Booking a hall, moving its
 * hours, keeping the catalogue — `manage_bookings`, the same right that books
 * a room: it is reception's daily work. Anything that opens a bill or posts
 * charges — `manage_documents`, the same right that issues invoices, because
 * that IS what it eventually becomes.
 */
import { NextResponse } from 'next/server';
import { withModule, type Actor } from '@core/auth/session';
import { requestPropertyScope } from '@core/auth/property-scope';
import * as events from '../data/events.repo';

/** A refusal the operator should read; anything else is logged and hidden. */
function refuse(e: unknown) {
  const message = e instanceof Error ? e.message : 'Failed';
  const expected = /not found|occupied|must be|before time_to|No tax rate/i.test(message);
  if (!expected) console.error('[events]', e);
  return NextResponse.json(
    { error: expected ? message : 'Failed' },
    { status: expected ? 409 : 500 },
  );
}

export const listSpaces = withModule('events', 'manage_bookings', async (request: Request, _ctx, actor: Actor) => {
  const all = new URL(request.url).searchParams.get('all') === '1';
  // Який ОБʼЄКТ, а не лише який орендар (INC-029): зали належать будинку.
  const scope = await requestPropertyScope(request, actor.organizationId);
  return NextResponse.json({ spaces: await events.listSpaces(scope, { all }) });
});

export const saveSpace = withModule('events', 'manage_bookings', async (request: Request) => {
  const body = await request.json().catch(() => ({})) as any;
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim();
  if (!name || !code || !body.property_id) {
    return NextResponse.json({ error: 'name, code and property_id are required' }, { status: 400 });
  }
  try {
    const id = await events.saveSpace({
      id: body.id ?? null,
      propertyId: String(body.property_id),
      name, code,
      capacityNote: body.capacity_note ?? null,
      blockPrices: body.block_prices ?? null,
      sortOrder: Number(body.sort_order) || 0,
      isActive: body.is_active ?? true,
    });
    return NextResponse.json({ id }, { status: body.id ? 200 : 201 });
  } catch (e) { return refuse(e); }
});

export const listAddons = withModule('events', 'manage_bookings', async (request: Request, _ctx, actor: Actor) => {
  const all = new URL(request.url).searchParams.get('all') === '1';
  const scope = await requestPropertyScope(request, actor.organizationId);
  return NextResponse.json({ addons: await events.listAddons(scope, { all }) });
});

export const saveAddon = withModule('events', 'manage_bookings', async (request: Request) => {
  const body = await request.json().catch(() => ({})) as any;
  const name = String(body.name || '').trim();
  const kind = String(body.kind || 'flat');
  if (!name || !body.property_id) {
    return NextResponse.json({ error: 'name and property_id are required' }, { status: 400 });
  }
  if (!['per_person', 'flat', 'per_hour', 'per_piece'].includes(kind)) {
    return NextResponse.json({ error: 'kind must be per_person, flat, per_hour or per_piece' }, { status: 400 });
  }
  try {
    const id = await events.saveAddon({
      id: body.id ?? null,
      propertyId: String(body.property_id),
      name,
      kind: kind as any,
      priceGross: Number(body.price_gross) || 0,
      vatCode: body.vat_code || 'standard',
      note: body.note ?? null,
      sortOrder: Number(body.sort_order) || 0,
      isActive: body.is_active ?? true,
    });
    return NextResponse.json({ id }, { status: body.id ? 200 : 201 });
  } catch (e) { return refuse(e); }
});

export const listBookings = withModule('events', 'manage_bookings', async (request: Request, _ctx, actor: Actor) => {
  const url = new URL(request.url);
  const scope = await requestPropertyScope(request, actor.organizationId);
  return NextResponse.json({
    bookings: await events.listBookings(scope, {
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
      spaceId: url.searchParams.get('space_id') || undefined,
    }),
  });
});

export const createBooking = withModule('events', 'manage_bookings', async (request: Request) => {
  const body = await request.json().catch(() => ({})) as any;
  const customerName = String(body.customer_name || '').trim();
  if (!body.space_id || !customerName) {
    return NextResponse.json({ error: 'space_id and customer_name are required' }, { status: 400 });
  }
  try {
    const made = await events.createBooking({
      spaceId: String(body.space_id),
      eventDate: String(body.event_date || ''),
      timeFrom: String(body.time_from || ''),
      timeTo: String(body.time_to || ''),
      persons: Number(body.persons) || 0,
      customerName,
      customerEmail: body.customer_email ?? null,
      customerPhone: body.customer_phone ?? null,
      company: body.company ?? null,
      status: body.status === 'draft' ? 'draft' : 'confirmed',
      notes: body.notes ?? null,
    });
    return NextResponse.json(made, { status: 201 });
  } catch (e) { return refuse(e); }
});

export const updateBooking = withModule('events', 'manage_bookings', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as any;
  try {
    await events.updateBooking(id, {
      eventDate: body.event_date,
      timeFrom: body.time_from,
      timeTo: body.time_to,
      persons: body.persons === undefined ? undefined : Number(body.persons),
      customerName: body.customer_name,
      customerEmail: body.customer_email,
      customerPhone: body.customer_phone,
      company: body.company,
      status: ['draft', 'confirmed', 'cancelled'].includes(body.status) ? body.status : undefined,
      notes: body.notes,
    });
    return NextResponse.json({ ok: true });
  } catch (e) { return refuse(e); }
});

/** Open (or return) the booking's folio — from here the finance endpoints take over. */
export const openBookingFolio = withModule('events', 'manage_documents', async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    return NextResponse.json({ folio_id: await events.openFolio(id) }, { status: 201 });
  } catch (e) { return refuse(e); }
});

/** Post the hall line and chosen add-ons onto the booking's folio. */
export const postBookingCharges = withModule('events', 'manage_documents', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as any;
  try {
    return NextResponse.json(await events.postEventCharges(id, {
      hallPriceGross: Number(body.hall_price_gross) || 0,
      // No fallback here: an absent field means «the hall decides», and the
      // repo asks the hall. Defaulting to a literal at this layer would put
      // the answer back into code, where no hotel file can reach it.
      hallVatCode: body.hall_vat_code || undefined,
      hallDescription: body.hall_description || undefined,
      addons: (Array.isArray(body.addons) ? body.addons : []).map((a: any) => ({
        addonId: String(a.addon_id || a.id || ''),
        quantity: a.quantity === undefined ? undefined : Number(a.quantity),
      })).filter((a: any) => a.addonId),
    }), { status: 201 });
  } catch (e) { return refuse(e); }
});
