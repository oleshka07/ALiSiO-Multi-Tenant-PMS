/**
 * The price matrix over HTTP: what a night costs at a given occupancy, and
 * what staying longer takes off it.
 *
 * `manage_pricing`, the same permission the day calendar uses — this is the
 * same act, entered as a rate card rather than day by day.
 *
 * Validation here is arithmetic, not policy. A negative price is refused
 * because it cannot be charged; a price of 40 € is not, because we do not know
 * what a hostel bed costs in the town this hotel is in. The product does not
 * argue with the owner about their own rates.
 */
import { NextResponse } from 'next/server';
import { withActor, withPermission } from '@core/auth/session';
import { handleError } from '@core/http/errors';
import {
  loadMatrix, createPrice, updatePrice, deletePrice,
  createTier, updateTier, deleteTier,
} from '../data/occupancy-price.repo';
import { quoteStay } from '../domain/occupancy-price';

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * An error the operator caused, told in words, rather than a 500.
 *
 * Everything requirePropertyId throws is one of those: not your property (404),
 * no property yet, or several and none named (400). Anything else is ours and
 * is logged, not explained.
 *
 * Тут стояло `/property/i.test(message)` — і це був той самий клас, що Р8.1,
 * лише в найгіршому вигляді: слово «propert» трапляється в тексті помилки
 * ДРАЙВЕРА («relation "properties" does not exist», «column
 * properties.country»), і така помилка їхала клієнтові дослівно, зі статусом
 * 400 і без жодного рядка в лозі. Тепер рід не вгадується за текстом: усе, що
 * кидає `requirePropertyId`, — названа відмова (`Refusal`), і `handleError`
 * розрізняє їх за родом, а не за словом.
 */
function answer(e: unknown): NextResponse {
  // Нуль і відʼємне — названа відмова (розділ A п.2), екран її перекладає.
  // Код лишається кодом, не текстом: цей рядок читає `pricing/page.tsx`.
  if (e instanceof Error && e.message === 'price_not_positive') {
    return NextResponse.json({ error: 'price_not_positive' }, { status: 400 });
  }
  return handleError('pricing/occupancy', e);
}

export const getOccupancyMatrix = withActor(async (request: Request) => {
  try {
    const propertyId = new URL(request.url).searchParams.get('property_id');
    return NextResponse.json(await loadMatrix(propertyId));
  } catch (e) { return answer(e); }
});

export const createOccupancyPrice = withPermission('manage_pricing', async (request: Request) => {
  const body = await request.json().catch(() => null) as any;

  // Тут `persons` — вісь САМОЇ матриці (`price_occupancy.persons`), і після
  // Ц12 вона означає ДОРОСЛИХ. Ім'я колонки лишається: перейменувати її —
  // це міграція живих цін заради слова, а сенс закріплено в домені й тут.
  const persons = Number(body?.persons);
  if (!Number.isInteger(persons) || persons < 1 || persons > 20) {
    return NextResponse.json({ error: 'persons must be a whole number from 1 to 20' }, { status: 400 });
  }
  const price = Number(body?.price_gross);
  // Нуль — не ціна (розділ A п.2, INC-017): тут стояло «0 is a real price — a
  // free night given to a partner is still a row», і нуль їхав у канал ціною.
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: 'price_not_positive' }, { status: 400 });
  }
  if (body.valid_from != null && body.valid_from !== '' && !isDate(body.valid_from)) {
    return NextResponse.json({ error: 'valid_from must be YYYY-MM-DD or empty' }, { status: 400 });
  }
  if (body.valid_to != null && body.valid_to !== '' && !isDate(body.valid_to)) {
    return NextResponse.json({ error: 'valid_to must be YYYY-MM-DD or empty' }, { status: 400 });
  }
  if (body.valid_from && body.valid_to && body.valid_to < body.valid_from) {
    return NextResponse.json({ error: 'valid_to is before valid_from' }, { status: 400 });
  }

  try {
    const id = await createPrice(body.property_id, {
      unit_type_id: body.unit_type_id || null,
      persons,
      price_gross: price,
      valid_from: body.valid_from || null,
      valid_to: body.valid_to || null,
      label: body.label || null,
    });
    // Not 400: the request is well formed, the row simply already exists.
    if (id == null) {
      return NextResponse.json(
        { error: 'A price for this category, occupancy and period already exists' },
        { status: 409 },
      );
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) { return answer(e); }
});

export const updateOccupancyPrice = withPermission('manage_pricing', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => null) as any;
  const price = Number(body?.price_gross);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: 'price_not_positive' }, { status: 400 });
  }
  try {
    const ok = await updatePrice(id, price, body.label ?? null);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return answer(e); }
});

export const deleteOccupancyPrice = withPermission('manage_pricing', async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    const ok = await deletePrice(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return answer(e); }
});

// ── Length-of-stay tiers ────────────────────────────────────────────────────

export const createLosTier = withPermission('manage_pricing', async (request: Request) => {
  const body = await request.json().catch(() => null) as any;

  const minNights = Number(body?.min_nights);
  if (!Number.isInteger(minNights) || minNights < 2 || minNights > 365) {
    // From two: a tier "from one night" is not a length-of-stay discount, it is
    // the price, and entering it here would hide it from the matrix.
    return NextResponse.json({ error: 'min_nights must be a whole number from 2 to 365' }, { status: 400 });
  }
  const adjustment = Number(body?.adjustment_gross);
  if (!Number.isFinite(adjustment)) {
    return NextResponse.json({ error: 'adjustment_gross must be a number' }, { status: 400 });
  }
  const persons = body?.persons == null || body.persons === '' ? null : Number(body.persons);
  if (persons != null && (!Number.isInteger(persons) || persons < 1 || persons > 20)) {
    return NextResponse.json({ error: 'persons must be empty or a whole number from 1 to 20' }, { status: 400 });
  }

  try {
    const id = await createTier(body.property_id, {
      unit_type_id: body.unit_type_id || null,
      min_nights: minNights,
      adjustment_gross: adjustment,
      persons,
      label: body.label || null,
    });
    if (id == null) {
      return NextResponse.json(
        { error: 'A tier for this category, threshold and occupancy already exists' },
        { status: 409 },
      );
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) { return answer(e); }
});

export const updateLosTier = withPermission('manage_pricing', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => null) as any;
  const adjustment = Number(body?.adjustment_gross);
  if (!Number.isFinite(adjustment)) {
    return NextResponse.json({ error: 'adjustment_gross must be a number' }, { status: 400 });
  }
  try {
    const ok = await updateTier(id, adjustment, body.label ?? null);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return answer(e); }
});

export const deleteLosTier = withPermission('manage_pricing', async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    const ok = await deleteTier(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { return answer(e); }
});

/**
 * What a stay would cost under the matrix as it stands.
 *
 * The same function the booking screen quotes with, exposed so the owner can
 * check a rate card against a case they have in mind before a guest does. A
 * night the matrix has no row for comes back in `missing` — the answer to
 * "why is this stay unsellable" is a list of dates, not a support ticket.
 */
export const quoteOccupancy = withActor(async (request: Request) => {
  const p = new URL(request.url).searchParams;
  const checkIn = p.get('check_in') ?? '';
  const nights = Number(p.get('nights'));
  const adults = Number(p.get('adults'));
  const unitTypeId = p.get('unit_type_id') ?? '';

  if (!isDate(checkIn)) return NextResponse.json({ error: 'check_in must be YYYY-MM-DD' }, { status: 400 });
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
    return NextResponse.json({ error: 'nights must be a whole number from 1 to 365' }, { status: 400 });
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > 20) {
    return NextResponse.json({ error: 'adults must be a whole number from 1 to 20' }, { status: 400 });
  }
  if (!unitTypeId) return NextResponse.json({ error: 'unit_type_id is required' }, { status: 400 });

  try {
    const matrix = await loadMatrix(p.get('property_id'));
    return NextResponse.json(quoteStay({
      checkIn, nights, adults, unitTypeId,
      matrix: matrix.prices,
      losTiers: matrix.tiers,
    }));
  } catch (e) { return answer(e); }
});
